// Wait for the DOM to be ready
document.addEventListener("DOMContentLoaded", function () {
    // Get reference to the table
    const table = document.querySelector("#next-event-row table");

    // Get reference to filter elements
    const locationFilter = document.getElementById("location-filter");
    const monthFilter = document.getElementById("month-filter");

    // Add event listeners for filtering
    locationFilter.addEventListener("change", filterTable);
    monthFilter.addEventListener("change", filterTable);

    // Find and display the next event
    findNextEvent();

    // Function to filter the table
    function filterTable() {
        const locationValue = locationFilter.value;
        const monthValue = monthFilter.value;

        for (const row of table.querySelectorAll("tbody tr")) {
            const cells = row.querySelectorAll("td");
            const location = cells[0].textContent;
            const date = cells[1].textContent;
            const eventMonth = new Date(date).getMonth() + 1;

            if (
                (locationValue === "all" || location === locationValue) &&
                (monthValue === "all" || eventMonth.toString() === monthValue)
            ) {
                row.style.display = "";
            } else {
                row.style.display = "none";
            }
        }
    }

    // Function to find and display the next event
    function findNextEvent() {
        const today = new Date();
        let closestEventDate = null;
        let closestEventTime = null;
        let closestEventTopics = null;

        for (const row of table.querySelectorAll("tbody tr")) {
            const cells = row.querySelectorAll("td");
            const date = new Date(cells[1].textContent);
            const time = cells[2].textContent;
            const topics = cells[3].textContent;

            if (date >= today) {
                if (!closestEventDate || date < closestEventDate) {
                    closestEventDate = date;
                    closestEventTime = time;
                    closestEventTopics = topics;
                }
            }
        }

        if (closestEventDate) {
            const formattedDate = closestEventDate.toLocaleDateString();
            console.log(
                `My next event is on ${formattedDate} at ${closestEventTime} and the topic(s) will be ${closestEventTopics}`
            );
        }
    }
});
