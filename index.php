<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Trivia with Kyle</title>
    <link rel="stylesheet" href="styles.css">
</head>
<body>
    <header>
        <h1>Trivia with Kyle</h1>
    </header>
    <nav>
        <a href="#">Home</a>
        <a href="trivia_cup.html">Ellison Trivia Cup Scores</a>
        <a href="upcoming_events.html">Upcoming Events</a>
    </nav>
    <div class="container">
        <h2>About Trivia with Kyle</h2>
        <p>
            Check out your <a href="trivia_cup.html">Ellison Trivia Cup Scores</a> or see what's topics are coming up in our <a href="upcoming_events.html">Upcoming Events</a>.
        </p>
    </div>
    <h1>Question of the Day</h1>
    <?php
    // Include the PHP script to fetch the question of the day
    include 'display_questions.php';

    // Get a random question from the array of questions
    $questionOfDay = $questions[array_rand($questions)];

    // Display the Question of the Day
    ?>
    <h2><?php echo $questionOfDay['question_text']; ?></h2>
    <ul>
        <?php foreach ($questionOfDay['answers'] as $answer) { ?>
            <li>
                <?php echo $answer['answer_text']; ?>
                <?php if ($answer['is_correct']) { echo " (Correct)"; }
                ?>
            </li>
        <?php } ?>
    </ul>
</body>
</html>