<?php
session_start();
?>
<?php
   require_once "config.php";
   // Define variables and initialize with empty values
   $uname = $pass = $pass2 = "";
   $uname_err = $pass_err = $pass2_err = "" ;

   // Processing form data when form is submitted
   if($_SERVER["REQUEST_METHOD"] == "POST"){
       // Validate name
       $uname = trim($_POST["uname"]);
       if(empty($uname)){
           $uname_err = "Please enter a username.";
       } elseif(!filter_var($uname, FILTER_VALIDATE_REGEXP, array("options"=>array("regexp"=>"/^[a-zA-Z\s]+$/")))){
           $uname_err = "Please enter a valid username.";
       }

       // Validate sID
       $pass = trim($_POST["password"]);
       if(empty($pass)){
           $pass_err = "Please enter your password.";
       }
       // Validate GPA
       $pass2 = trim($_POST["password2"]);
       if(empty($pass2)){
           $pass2_err = "Please re-enter your password.";
       }

       if (empty($pass_err) && empty($pass2_err) && $pass != $pass2) {
         $pass2_err = "Your passwords do not match.";
       }

       // Check input errors before inserting in database
       if(empty($uname_err) && empty($pass_err) && empty($pass2_err)){
            // Prepare an insert statement

            $salt = base64_encode(mcrypt_create_iv(12 , MCRYPT_DEV_URANDOM));

            $sql = "INSERT INTO User(uname, password, salt) VALUES ('$uname', MD5('$pass$salt'), '$salt')";
            mysqli_query($link, $sql);
       }

       // Close connection
       mysqli_close($link);
   }
   ?>

   <!DOCTYPE html>
   <html lang="en">
   <head>
       <meta charset="UTF-8">
       <title>Create Record</title>
       <link rel="stylesheet" href="https://maxcdn.bootstrapcdn.com/bootstrap/3.3.7/css/bootstrap.css">
       <style type="text/css">
           .wrapper{
               width: 500px;
               margin: 0 auto;
           }
       </style>
   </head>
   <body>
       <div class="wrapper">
           <div class="container-fluid">
               <div class="row">
                   <div class="col-md-12">
                       <div class="page-header">
                           <h2>Create Record</h2>
                       </div>
                       <p>Please fill this form and submit to add a Student record to the database.</p>
                       <form action="<?php echo htmlspecialchars($_SERVER["PHP_SELF"]); ?>" method="post">
                           <div class="form-group <?php echo (!empty($uname_err)) ? 'has-error' : ''; ?>">
                               <label>Username</label>
                               <input type="text" name="uname" class="form-control" value="<?php echo $uname; ?>">
                               <span class="help-block"><?php echo $uname_err;?></span>
                           </div>
                           <div class="form-group <?php echo (!empty($pass_err)) ? 'has-error' : ''; ?>">
                               <label>Password</label>
                               <input type="text" name="password" class="form-control" value="<?php echo $pass; ?>">
                               <span class="help-block"><?php echo $pass_err;?></span>
                           </div>
                           <div class="form-group <?php echo (!empty($pass2_err)) ? 'has-error' : ''; ?>">
                               <label>Password Again</label>
                               <input type="text" name="password2" class="form-control" value="<?php echo $pass2; ?>">
                               <span class="help-block"><?php echo $pass2_err;?></span>
                           </div>
                           <input type="submit" class="btn btn-primary" value="Submit">
                           <a href="index.php" class="btn btn-default">Cancel</a>
                       </form>
                   </div>
               </div>
           </div>
       </div>
   </body>
   </html>
