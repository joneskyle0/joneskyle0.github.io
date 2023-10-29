document.addEventListener("DOMContentLoaded", function () {
    const table = document.querySelector(".upcoming-events tbody");
    const today = new Date();
    let nextEventDate = null;
    let nextEventLocation = null;
    let nextEventTime = null;
    let nextEventTopic = null;

    for (const row of table.rows) {
        const dateCell = row.cells[1];
        const locationCell = row.cells[0];
        const timeCell = row.cells[2];
        const topicCell = row.cells[3];

        const eventDate = new Date(dateCell.textContent);

        if (eventDate >= today && (!nextEventDate || eventDate < nextEventDate)) {
            nextEventDate = eventDate;
            nextEventLocation = locationCell.textContent;
            nextEventTime = timeCell.textContent;
            nextEventTopic = topicCell.textContent;
        }
    }

    if (nextEventDate) {
        const formattedDate = nextEventDate.toLocaleDateString();
        const message = `My next event is at ${nextEventLocation} at ${nextEventTime} and the topic(s) will be ${nextEventTopic}`;
        const eventInfo = document.createElement("p");
        eventInfo.textContent = message;
        document.body.insertBefore(eventInfo, table);
    }
});
