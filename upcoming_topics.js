document.addEventListener("DOMContentLoaded", function () {
    const currentDate = new Date();

    const rows = document.querySelectorAll(".upcoming-topics tbody tr");

    for (let row of rows) {
        const dateString = row.querySelector("td:first-child").innerText;
        const [month, day, year] = dateString.split("/");
        const rowDate = new Date(`${year}-${month}-${day}`);

        if (rowDate >= currentDate) {
            const topic = row.querySelector("td:nth-child(2)").innerText;
            const message = `The next topic is ${topic}`;

            const upcomingTopicElement = document.getElementById("upcoming-topic");
            upcomingTopicElement.querySelector(".large-text").textContent = message;
            break;
        }
    }
});
