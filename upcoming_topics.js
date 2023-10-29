document.addEventListener("DOMContentLoaded", function () {
    // Find the first row of the table (skipping the header row)
    const firstRow = document.querySelector(".upcoming-topics tbody tr:first-child");

    // Get the date and topic from the first row
    const date = firstRow.querySelector("td:first-child").textContent;
    const topic = firstRow.querySelector("td:nth-child(2)").textContent;

    // Create a message for the upcoming topic
    const message = `Next week's topic is ${date}: ${topic}`;

    // Display the message above the table
    const upcomingTopicElement = document.getElementById("upcoming-topic");
    upcomingTopicElement.querySelector(".large-text").textContent = message;
});
