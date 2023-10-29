document.addEventListener("DOMContentLoaded", function () {
    // Find the current date
    const currentDate = new Date();

    // Calculate the next date (one week later)
    currentDate.setDate(currentDate.getDate() + 7);

    // Format the next date as "MM/DD/YYYY"
    const nextDate = `${currentDate.getMonth() + 1}/${currentDate.getDate()}/${currentDate.getFullYear()}`;

    // Get the topics number from the first row
    const firstRow = document.querySelector(".upcoming-topics tbody tr:first-child");
    const topicsNumber = parseInt(firstRow.querySelector("td:nth-child(2)").textContent.match(/\d+/)[0]);

    // Create a message for the upcoming topics
    const message = `Next week's topic is ${nextDate}: Topics ${topicsNumber + 1}`;

    // Display the message above the table with larger size and centered
    const upcomingTopicsElement = document.getElementById("upcoming-topics");
    upcomingTopicsElement.innerHTML = `<p class="large-text">${message}</p>`;
});
