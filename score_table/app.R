library(shiny)
library(tidyverse)
library(googlesheets4)

gs4_deauth()
sheet_url <- "https://docs.google.com/spreadsheets/d/1HN9DBfcqDKTqf2J-maAZa3uQOltW2QDhpjxYMaM5_FM/edit#gid=2101542749"
df <- read_sheet(sheet_url)

data <- df |>
  select(-cumulative) |>
  pivot_longer(!team, names_to = "date", values_to = "score") |>
  mutate(date = date(mdy(date))) |>
  group_by(team) |>
  drop_na() |>
  mutate(cs = cumsum(score))

teams_with_multiple_dates <- data |>
  group_by(team) |>
  summarise(unique_dates = n_distinct(date)) |>
  filter(unique_dates > 1) |>
  pull(team)

ui <- fluidPage(
  titlePanel("Ellison Trivia Cup Scores"),
  sidebarLayout(
    sidebarPanel(
      radioButtons("display_type", "Select Display Type:",
                   choices = c("Graph", "Table"),
                   selected = "Table"
      ),
      width = 2,
      conditionalPanel(
        condition = "input.display_type == 'Graph'",
        checkboxGroupInput("teams", "Select Teams", 
                           choices = teams_with_multiple_dates, 
                           selected = head(names(sort(tapply(data$cs, data$team, max, na.rm = TRUE), decreasing = TRUE)), 5)
        )
      )
    ),
    mainPanel(
      conditionalPanel(
        condition = "input.display_type == 'Graph'",
        plotOutput("lineplot", height = "600px")
      ),
      conditionalPanel(
        condition = "input.display_type == 'Table'",
        dataTableOutput('datatable')
      )
    )
  )
)

server <- function(input, output) {
  output$lineplot <- renderPlot({
    if (input$display_type == 'Graph') {
      filtered_data <- data |>
        filter(team %in% input$teams)
      
      p <- ggplot(filtered_data, aes(x = date, y = cs, color = team)) +
        geom_line() +
        labs(x = "Date", y = "Score") +
        theme_minimal() +
        theme(
          text = element_text(size = 16),
          legend.text = element_text(size = 14),
          legend.position = "bottom",
          legend.title = element_blank()
        )
      
      print(p)
    }
  })
  
  output$datatable <- renderDataTable({
    if (input$display_type == 'Table') {
      df |>
        relocate(cumulative, .after = team) |>
        rename(score = cumulative) |>
        arrange(desc(score)) |>
        select_if(~!all(is.na(.)))
    }
  })
}

shinyApp(ui, server)
