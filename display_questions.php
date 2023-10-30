<?php
$host = "localhost";
$username = "joneskyle0";
$password = "Vr++i8^lnr/M,f:6\*i8";
$database = "qotd";

$connection = mysqli_connect($host, $username, $password, $database);

if (!$connection) {
    die("Connection failed: " . mysqli_connect_error());
}

$query = "SELECT * FROM Questions";
$result = mysqli_query($connection, $query);

$questions = array();

while ($row = mysqli_fetch_assoc($result)) {
    $question = array(
        'question_text' => $row['question_text'],
        'answers' => array(),
    );

    $answers_query = "SELECT * FROM Answers WHERE question_id = " . $row['id'];
    $answers_result = mysqli_query($connection, $answers_query);

    while ($answer_row = mysqli_fetch_assoc($answers_result)) {
        $question['answers'][] = array(
            'answer_text' => $answer_row['answer_text'],
            'is_correct' => $answer_row['is_correct'],
        );
    }

    $questions[] = $question;
}
?>
<!DOCTYPE html>
<html>
<head>
    <title>Questions and Answers</title>
</head>
<body>
    <h1>Questions of the Day</h1>
    <ul>
        <?php foreach ($questions as $question) { ?>
            <li>
                <strong><?php echo $question['question_text']; ?></strong>
                <ul>
                    <?php foreach ($question['answers'] as $answer) { ?>
                        <li>
                            <?php echo $answer['answer_text']; ?>
                            <?php if ($answer['is_correct']) { echo "(Correct)"; }
                            ?>
                        </li>
                    <?php } ?>
                </ul>
            </li>
        <?php } ?>
    </ul>
</body>
</html>
<?php
mysqli_close($connection);
?>
