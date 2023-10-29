document.addEventListener("DOMContentLoaded", function () {
    const currentDate = new Date();

    const rows = document.querySelectorAll(".upcoming-events tbody tr");

    let nextEventDate = null;
    let nextEventTime = null;
    let nextEventTopic = null;

    for (let row of rows) {
        const dateString = row.querySelector("td:nth-child(2)").innerText;
        const [month, day, year] = dateString.split("/");
        const rowDate = new Date(`${year}-${month}-${day}T19:00:00`); // Assume 7:00 PM for the event time

        if (rowDate >= currentDate) {
            nextEventDate = dateString;
            nextEventTime = row.querySelector("td:nth-child(3)").innerText;
            nextEventTopic = row.querySelector("td:nth-child(4)").innerText;
            break;
        }
    }

    const upcomingTopicElement = document.getElementById("upcoming-topic");
    if (nextEventDate && nextEventTime && nextEventTopic) {
        const message = `My next event is ${nextEventDate} at ${nextEventTime} and the topic(s) will be ${nextEventTopic}`;
        upcomingTopicElement.querySelector(".large-text").textContent = message;
    } else {
        upcomingTopicElement.querySelector(".large-text").textContent = "Stay tuned for upcoming events!";
    }
});
