<?php
// Connect to the MySQL database
$servername = "localhost";
$username = "joneskyle0";
$password = "Vr++i8^lnr/M,f:6\*i8";
$dbname = "qotd";

$conn = new mysqli($servername, $username, $password, $dbname);

// Check connection
if ($conn->connect_error) {
    die("Connection failed: " . $conn->connect_error);
}

// Fetch a random question from the qotd table
$sql = "SELECT question FROM questions ORDER BY RAND() LIMIT 1";
$result = $conn->query($sql);

if ($result->num_rows > 0) {
    $row = $result->fetch_assoc();
    $question = $row["question"];
    echo json_encode($question);
} else {
    echo "No question found";
}

$conn->close();
?>