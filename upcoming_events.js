document.addEventListener("DOMContentLoaded", function () {
    // Initialize DataTables with sorting by the date column in descending order
    const table = $('#upcoming-events').DataTable({
        "order": [[1, "desc"]] // 1 corresponds to the Date column
    });

    // Select elements for filtering
    const locationFilter = document.getElementById("location-filter");
    const monthFilter = document.getElementById("month-filter");
    const nextEventRow = document.getElementById("next-event-row");

    // Table rows
    const rows = document.querySelectorAll(".upcoming-events tbody tr");

    // Find the next event
    const currentDate = new Date();
    let nextEvent = null;

    for (let row of rows) {
        const dateStr = row.querySelector("td:nth-child(2)").textContent;
        const [month, day, year] = dateStr.split("/");
        const eventDate = new Date(`${year}-${month}-${day}T00:00:00`);

        if (eventDate >= currentDate) {
            nextEvent = row;
            break;
        }
    }

    if (nextEvent) {
        const location = nextEvent.querySelector("td:first-child a").textContent;
        const date = nextEvent.querySelector("td:nth-child(2)").textContent;
        const time = nextEvent.querySelector("td:nth-child(3)").textContent;
        const topic = nextEvent.querySelector("td:nth-child(4)").textContent;

        const message = `My next event is on ${date} at ${location} and the topic(s) will be ${topic}.`;
        nextEventRow.innerHTML = `<table><thead><tr><th>Location</th><th>Date</th><th>Time</th><th>Topic</th></tr></thead></table><tbody><tr><td>${location}</td><td>${date}</td><td>${time}</td><td>${topic}</td></tr></tbody>`;
        document.getElementById("upcoming-topic").textContent = message;
    }

    // Add event listeners for filters
    locationFilter.addEventListener("change", filterTable);
    monthFilter.addEventListener("change", filterTable);

    // Function to filter the table based on location and month (unchanged)
    function filterTable() {
        // ...
    }
});
