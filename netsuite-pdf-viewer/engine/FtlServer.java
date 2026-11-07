import freemarker.core.ParseException;
import freemarker.template.Configuration;
import freemarker.template.DefaultObjectWrapper;
import freemarker.template.DefaultObjectWrapperBuilder;
import freemarker.template.Template;
import freemarker.template.TemplateException;
import freemarker.template.TemplateExceptionHandler;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.PrintStream;
import java.io.StringReader;
import java.io.StringWriter;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Long-running FreeMarker renderer speaking JSON lines over stdin/stdout.
 *
 * Request:  {"id":1,"name":"invoice.ftl","template":"...","data":{...},"locale":"en_US","lenient":false}
 * Response: {"id":1,"html":"..."}  or  {"id":1,"error":{"type":"parse|runtime","message":"...","line":12,"col":5}}
 *
 * Only the official FreeMarker jar is needed on the classpath; JSON handling is built in
 * so there are no further dependencies to download.
 */
public class FtlServer {

    private static final Pattern ISO_DATE = Pattern.compile("^\\d{4}-\\d{2}-\\d{2}(T\\d{2}:\\d{2}(:\\d{2}(\\.\\d+)?)?(Z|[+-]\\d{2}:?\\d{2})?)?$");
    private static final Pattern AT_LINE = Pattern.compile("at line (\\d+), column (\\d+)");

    public static void main(String[] args) throws Exception {
        BufferedReader in = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8));
        PrintStream out = new PrintStream(System.out, true, "UTF-8");
        out.println("{\"ready\":true,\"freemarker\":\"" + Configuration.getVersion() + "\"}");
        String line;
        while ((line = in.readLine()) != null) {
            if (line.isBlank()) continue;
            Object id = null;
            try {
                Map<String, Object> req = asMap(Json.parse(line));
                id = req.get("id");
                if (Boolean.TRUE.equals(req.get("ping"))) {
                    out.println("{\"id\":" + Json.write(id) + ",\"pong\":true}");
                    continue;
                }
                String html = render(req);
                out.println("{\"id\":" + Json.write(id) + ",\"html\":" + Json.write(html) + "}");
            } catch (ParseException pe) {
                out.println(errorJson(id, "parse", cleanMessage(pe.getMessage()), pe.getLineNumber(), pe.getColumnNumber()));
            } catch (TemplateException te) {
                int[] pos = positionFromMessage(te.getMessage());
                out.println(errorJson(id, "runtime", cleanMessage(te.getMessageWithoutStackTop()), pos[0], pos[1]));
            } catch (Throwable t) {
                int[] pos = positionFromMessage(String.valueOf(t.getMessage()));
                out.println(errorJson(id, "internal", t.getClass().getSimpleName() + ": " + t.getMessage(), pos[0], pos[1]));
            }
        }
    }

    private static String render(Map<String, Object> req) throws Exception {
        String name = str(req.get("name"), "template.ftl");
        String source = str(req.get("template"), "");
        Locale locale = parseLocale(str(req.get("locale"), "en_US"));
        boolean lenient = Boolean.TRUE.equals(req.get("lenient"));

        Configuration cfg = new Configuration(Configuration.VERSION_2_3_34);
        cfg.setDefaultEncoding("UTF-8");
        cfg.setLocale(locale);
        cfg.setLogTemplateExceptions(false);
        cfg.setWrapUncheckedExceptions(true);
        cfg.setFallbackOnNullLoopVariable(false);
        // NetSuite-like defaults: locale-aware numbers, US short dates.
        cfg.setNumberFormat(str(req.get("numberFormat"), "number"));
        cfg.setDateFormat(str(req.get("dateFormat"), "M/d/yyyy"));
        cfg.setTimeFormat(str(req.get("timeFormat"), "h:mm a"));
        cfg.setDateTimeFormat(str(req.get("dateTimeFormat"), "M/d/yyyy h:mm a"));
        cfg.setTemplateExceptionHandler(lenient ? INLINE_ERROR_HANDLER : TemplateExceptionHandler.RETHROW_HANDLER);
        DefaultObjectWrapper wrapper = new DefaultObjectWrapperBuilder(Configuration.VERSION_2_3_34).build();
        cfg.setObjectWrapper(wrapper);

        Object model = convert(req.get("data"));
        if (!(model instanceof Map)) model = new LinkedHashMap<String, Object>();
        // NetSuite exposes `nsfont` (font file URLs) with many keys; make any key resolve
        // so templates never fail on e.g. ${nsfont.NotoSansCJKsc_Regular}.
        @SuppressWarnings("unchecked")
        Map<String, Object> modelMap = (Map<String, Object>) model;
        Object nsfont = modelMap.get("nsfont");
        modelMap.put("nsfont", new LenientHash(nsfont instanceof Map ? (Map<?, ?>) nsfont : null, "nsfont://"));

        Template template = new Template(name, new StringReader(source), cfg);
        StringWriter writer = new StringWriter();
        template.process(model, writer);
        return writer.toString();
    }

    /** Recursively turn parsed JSON into FreeMarker-friendly objects (dates from ISO strings). */
    @SuppressWarnings("unchecked")
    private static Object convert(Object value) {
        if (value instanceof Map) {
            Map<String, Object> src = (Map<String, Object>) value;
            Map<String, Object> dst = new LinkedHashMap<>();
            for (Map.Entry<String, Object> e : src.entrySet()) dst.put(e.getKey(), convert(e.getValue()));
            return dst;
        }
        if (value instanceof List) {
            List<Object> dst = new ArrayList<>();
            for (Object o : (List<Object>) value) dst.add(convert(o));
            return dst;
        }
        if (value instanceof String) {
            String s = (String) value;
            if (s.length() >= 10 && s.length() <= 35 && ISO_DATE.matcher(s).matches()) {
                Date d = parseIsoDate(s);
                if (d != null) return d;
            }
            return s;
        }
        return value;
    }

    private static Date parseIsoDate(String s) {
        try {
            // java.sql.Date / Timestamp tell FreeMarker whether a value is a date or a date-time.
            if (s.length() == 10) {
                return java.sql.Date.valueOf(LocalDate.parse(s));
            }
            if (s.endsWith("Z") || s.matches(".*[+-]\\d{2}:?\\d{2}$")) {
                return new java.sql.Timestamp(Instant.parse(s.replaceAll("([+-]\\d{2})(\\d{2})$", "$1:$2")).toEpochMilli());
            }
            return java.sql.Timestamp.valueOf(LocalDateTime.parse(s));
        } catch (DateTimeParseException ex) {
            return null;
        }
    }

    private static Locale parseLocale(String tag) {
        String[] parts = tag.replace('-', '_').split("_");
        if (parts.length >= 2) return new Locale(parts[0], parts[1]);
        return new Locale(parts[0]);
    }

    private static String errorJson(Object id, String type, String message, int line, int col) {
        return "{\"id\":" + Json.write(id) + ",\"error\":{\"type\":" + Json.write(type)
                + ",\"message\":" + Json.write(message) + ",\"line\":" + line + ",\"col\":" + col + "}}";
    }

    private static int[] positionFromMessage(String message) {
        if (message == null) return new int[]{0, 0};
        Matcher m = AT_LINE.matcher(message);
        if (m.find()) return new int[]{Integer.parseInt(m.group(1)), Integer.parseInt(m.group(2))};
        return new int[]{0, 0};
    }

    private static String cleanMessage(String message) {
        if (message == null) return "Unknown error";
        // Drop FreeMarker's trailing "----\nFTL stack trace..." block; keep the human part.
        int idx = message.indexOf("\n----");
        return (idx > 0 ? message.substring(0, idx) : message).trim();
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> asMap(Object o) {
        if (o instanceof Map) return (Map<String, Object>) o;
        throw new IllegalArgumentException("Request must be a JSON object");
    }

    private static String str(Object o, String dflt) {
        return o == null ? dflt : String.valueOf(o);
    }

    /** Lenient mode: write the error inline (highlighted) and keep going, like a "debug" render. */
    private static final TemplateExceptionHandler INLINE_ERROR_HANDLER = (te, env, out) -> {
        try {
            String blamed = te.getBlamedExpressionString();
            String msg = blamed != null ? blamed : cleanMessage(te.getMessageWithoutStackTop());
            if (msg.contains("\n")) msg = msg.substring(0, msg.indexOf('\n'));
            String full = cleanMessage(te.getMessageWithoutStackTop()).replace("\"", "&quot;").replace("<", "&lt;");
            out.write("<span class=\"nsv-missing\" style=\"color:#b42318;background:#fdecea;border:1px dashed #b42318;padding:0 2px;font-size:smaller\" title=\""
                    + full + "\">[" + msg.replace("<", "&lt;") + "]</span>");
        } catch (java.io.IOException e) {
            throw new TemplateException("Failed to write inline error", e, env);
        }
    };

    /** Hash that returns a placeholder string for unknown keys instead of failing. */
    static final class LenientHash implements freemarker.template.TemplateHashModel {
        private final Map<?, ?> backing;
        private final String prefix;

        LenientHash(Map<?, ?> backing, String prefix) {
            this.backing = backing;
            this.prefix = prefix;
        }

        @Override
        public freemarker.template.TemplateModel get(String key) {
            Object v = backing == null ? null : backing.get(key);
            return new freemarker.template.SimpleScalar(v == null ? prefix + key : String.valueOf(v));
        }

        @Override
        public boolean isEmpty() { return false; }
    }

    /** Minimal JSON reader/writer (objects keep insertion order; integers -> Long, decimals -> BigDecimal). */
    static final class Json {
        private final String s;
        private int i = 0;

        private Json(String s) { this.s = s; }

        static Object parse(String s) {
            Json j = new Json(s);
            j.ws();
            Object v = j.value();
            j.ws();
            if (j.i != s.length()) throw new IllegalArgumentException("Trailing characters in JSON at " + j.i);
            return v;
        }

        private Object value() {
            if (i >= s.length()) throw new IllegalArgumentException("Unexpected end of JSON");
            char c = s.charAt(i);
            switch (c) {
                case '{': return object();
                case '[': return array();
                case '"': return string();
                case 't': expect("true"); return Boolean.TRUE;
                case 'f': expect("false"); return Boolean.FALSE;
                case 'n': expect("null"); return null;
                default: return number();
            }
        }

        private Map<String, Object> object() {
            Map<String, Object> m = new LinkedHashMap<>();
            i++; ws();
            if (s.charAt(i) == '}') { i++; return m; }
            while (true) {
                ws();
                String k = string();
                ws(); expect(":"); ws();
                m.put(k, value());
                ws();
                char c = s.charAt(i++);
                if (c == '}') return m;
                if (c != ',') throw new IllegalArgumentException("Expected , or } at " + (i - 1));
            }
        }

        private List<Object> array() {
            List<Object> l = new ArrayList<>();
            i++; ws();
            if (s.charAt(i) == ']') { i++; return l; }
            while (true) {
                ws();
                l.add(value());
                ws();
                char c = s.charAt(i++);
                if (c == ']') return l;
                if (c != ',') throw new IllegalArgumentException("Expected , or ] at " + (i - 1));
            }
        }

        private String string() {
            if (s.charAt(i) != '"') throw new IllegalArgumentException("Expected string at " + i);
            i++;
            StringBuilder b = new StringBuilder();
            while (true) {
                char c = s.charAt(i++);
                if (c == '"') return b.toString();
                if (c == '\\') {
                    char e = s.charAt(i++);
                    switch (e) {
                        case '"': b.append('"'); break;
                        case '\\': b.append('\\'); break;
                        case '/': b.append('/'); break;
                        case 'b': b.append('\b'); break;
                        case 'f': b.append('\f'); break;
                        case 'n': b.append('\n'); break;
                        case 'r': b.append('\r'); break;
                        case 't': b.append('\t'); break;
                        case 'u': b.append((char) Integer.parseInt(s.substring(i, i + 4), 16)); i += 4; break;
                        default: throw new IllegalArgumentException("Bad escape at " + (i - 1));
                    }
                } else {
                    b.append(c);
                }
            }
        }

        private Object number() {
            int start = i;
            while (i < s.length() && "+-0123456789.eE".indexOf(s.charAt(i)) >= 0) i++;
            String n = s.substring(start, i);
            if (n.isEmpty()) throw new IllegalArgumentException("Unexpected character '" + s.charAt(i) + "' at " + i);
            if (n.contains(".") || n.contains("e") || n.contains("E")) return new BigDecimal(n);
            try { return Long.parseLong(n); } catch (NumberFormatException ex) { return new BigDecimal(n); }
        }

        private void expect(String lit) {
            if (!s.startsWith(lit, i)) throw new IllegalArgumentException("Expected " + lit + " at " + i);
            i += lit.length();
        }

        private void ws() {
            while (i < s.length() && Character.isWhitespace(s.charAt(i))) i++;
        }

        static String write(Object v) {
            if (v == null) return "null";
            if (v instanceof Number || v instanceof Boolean) return v.toString();
            String str = v.toString();
            StringBuilder b = new StringBuilder(str.length() + 16).append('"');
            for (int k = 0; k < str.length(); k++) {
                char c = str.charAt(k);
                switch (c) {
                    case '"': b.append("\\\""); break;
                    case '\\': b.append("\\\\"); break;
                    case '\n': b.append("\\n"); break;
                    case '\r': b.append("\\r"); break;
                    case '\t': b.append("\\t"); break;
                    default:
                        if (c < 0x20) b.append(String.format("\\u%04x", (int) c)); else b.append(c);
                }
            }
            return b.append('"').toString();
        }
    }
}
