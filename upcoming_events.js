document.addEventListener("DOMContentLoaded", function () {
    const currentDate = new Date();

    // Select elements for filtering
    const locationFilter = document.getElementById("location-filter");
    const monthFilter = document.getElementById("month-filter");

    // Table rows
    const rows = document.querySelectorAll(".upcoming-events tbody tr");

    // Add event listeners for filters
    locationFilter.addEventListener("change", filterTable);
    monthFilter.addEventListener("change", filterTable);

    // Function to filter the table based on location and month
    function filterTable() {
        const selectedLocation = locationFilter.value;
        const selectedMonth = monthFilter.value;

        for (let row of rows) {
            const location = row.querySelector("td:first-child a").textContent;
            const date = row.querySelector("td:nth-child(2)").textContent;
            const [month,] = date.split("/");

            if (
                (selectedLocation === "all" || location === selectedLocation) &&
                (selectedMonth === "all" || month === selectedMonth)
            ) {
                row.style.display = "table-row";
            } else {
                row.style.display = "none";
            }
        }
    }

    // Initial filter
    filterTable();
});
