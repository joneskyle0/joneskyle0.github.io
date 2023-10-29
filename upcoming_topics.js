document.addEventListener("DOMContentLoaded", function () {
    const currentDate = new Date();

    const rows = document.querySelectorAll(".upcoming-topics tbody tr");

    let nextTopic = null;
    let nextDate = null;

    for (let row of rows) {
        const dateString = row.querySelector("td:first-child").innerText;
        const [month, day, year] = dateString.split("/");
        const rowDate = new Date(`${year}-${month}-${day}`);

        if (rowDate >= currentDate) {
            nextTopic = row.querySelector("td:nth-child(2)").innerText;
            nextDate = dateString;
            break;
        }
    }

    const upcomingTopicElement = document.getElementById("upcoming-topic");
    if (nextTopic && nextDate) {
        const message = `The next topic is ${nextTopic} on ${nextDate}`;
        upcomingTopicElement.querySelector(".large-text").textContent = message;
    } else {
        upcomingTopicElement.querySelector(".large-text").textContent = "Stay tuned for upcoming dates!";
    }
});
