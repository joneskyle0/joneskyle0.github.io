document.addEventListener("DOMContentLoaded", function () {
    const table = document.querySelector(".upcoming-events tbody");
    const today = new Date();
    let nextEventDate = null;
    let nextEventLocation = null;
    let nextEventTime = null;
    let nextEventTopic = null;

    // Loop through the table rows to find the next event
    for (const row of table.rows) {
        const dateCell = row.cells[1];
        const locationCell = row.cells[0];
        const timeCell = row.cells[2];
        const topicCell = row.cells[3];

        // Parse the date in "M/D/YYYY" format
        const dateParts = dateCell.textContent.split("/");
        const eventDate = new Date(`${dateParts[2]}-${dateParts[0]}-${dateParts[1]}`);

        // Check if the event date is today or in the future
        if (eventDate >= today) {
            if (!nextEventDate || eventDate < nextEventDate) {
                nextEventDate = eventDate;
                nextEventLocation = locationCell.textContent;
                nextEventTime = timeCell.textContent;
                nextEventTopic = topicCell.textContent;
            }
        }
    }

    // Display the information above the table
    if (nextEventDate) {
        const formattedDate = nextEventDate.toLocaleDateString();
        const message = `My next event is at ${nextEventLocation} at ${nextEventTime} and the topic(s) will be ${nextEventTopic}`;
        const eventInfo = document.createElement("p");
        eventInfo.textContent = message;
        document.body.insertBefore(eventInfo, table);
    }
});
