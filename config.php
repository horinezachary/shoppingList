<?php
  // Define database connection constants
  define('DB_HOST', '192.168.1.112');
  define('DB_USER', 'app');
  define('DB_PASSWORD', '8eKta0TjuU6Pijfd');
  define('DB_NAME', 'loris_kitchen');

/* Attempt to connect to MySQL database */
$link = mysqli_connect(DB_HOST, DB_USER, DB_PASSWORD, DB_NAME);

// Check connection
if($link === false){
    die("ERROR: Could not connect. " . mysqli_connect_error());
}
?>
