$(document).ready(function () {
    // Initialize DataTable with "datetime-moment" sorting
    $('.upcoming-events').DataTable({
        columnDefs: [{
            type: 'datetime-moment',
            targets: 0,
            render: function (data, type, row) {
                if (type === 'sort') {
                    return moment(data, 'M/D/YYYY').valueOf();
                }

                // Find the next event
                var currentDate = moment(); // Get the current date and time
                var tableData = $('.upcoming-events').DataTable().rows().data(); // Get the table data
                var nextEvent = null;

                for (var i = 0; i < tableData.length; i++) {
                    var eventDate = moment(tableData[i][0], 'M/D/YYYY');
                    var eventTime = tableData[i][1];
                    var eventTopic = tableData[i][2];

                    if (eventDate.isSameOrAfter(currentDate, 'day')) {
                        nextEvent = {
                            date: eventDate.format('M-D-Y'),
                            time: eventTime,
                            topic: eventTopic
                        };
                        break; // Exit the loop after finding the next event
                    }
                }

                if (nextEvent) {
                    $('#event-date').text(nextEvent.date);
                    $('#event-time').text(nextEvent.time);
                    $('#event-topic').text(nextEvent.topic);
                }

                return moment(data, 'M/D/YYYY').format('M-D-Y');
            }
        }],
        searching: false
    });

    $('.dataTables_length').hide();
});
