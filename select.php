<?php
   require_once "config.php";

   $query = "SELECT * FROM Recipe";
   $recipes = mysqli_query($link, $query);
   if (!$recipes) {
      die("Query to show fields from table failed");
   }
   echo "<table class='table table-bordered table-striped'>";
      echo "<thead>";
         echo "<tr>";
            echo "<th>ID</th>";
            echo "<th>Name</th>";
            echo "<th>Owner</th>";
            echo "<th>Source</th>";
         echo "</tr>";
      echo "</thead>";
      echo "<tbody>";
         while($row = mysqli_fetch_array($recipes)){
            echo "<tr>";
               echo "<td>" . $row[0] . "</td>";
               echo "<td>" . $row[1] . "</td>";
               echo "<td>" . $row[2] . "</td>";
               echo "<td>" . $row[3] . "</td>";
            echo "</tr>";
         }
      echo "</tbody>";
   echo "</table>";
   mysqli_free_result($result);

 ?>
