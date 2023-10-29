document.addEventListener("DOMContentLoaded", function () {
    // Find the current date
    const currentDate = new Date();

    // Calculate the next date (one week later)
    currentDate.setDate(currentDate.getDate() + 7);

    // Format the next date as "MM/DD/YYYY"
    const nextDate = `${currentDate.getMonth() + 1}/${currentDate.getDate()}/${currentDate.getFullYear()}`;

    // Get the topic number from the first row
    const firstRow = document.querySelector(".upcoming-topics tbody tr:first-child");
    const topicNumber = parseInt(firstRow.querySelector("td:nth-child(2)").textContent.match(/\d+/)[0]);

    // Create a message for the upcoming topic
    const message = `Next week's topic is ${nextDate}: Topic ${topicNumber + 1}`;

    // Display the message above the table
    const upcomingTopicElement = document.getElementById("upcoming-topic");
    upcomingTopicElement.querySelector(".large-text").textContent = message;
});
