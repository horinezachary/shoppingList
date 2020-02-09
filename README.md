### Purpose
  This web app is a full stack implementation of a shopping list database. It was built for my mother, Lori, as a way to keep track of all of her different shopping lists.
  Some of the most important features were the ability to have multiple lists, all with their own customizable name and color, and the ability to cross things off of your list without deleting them.
  During this project, I learned alot about full stack development, using node.js, mysql and apache. I got to learn alot about SSL and TLS and how they play into web security, as the site is secured via https. I hope to continue adding features, some of which are listed below.
### Features to come:
- Print Friendly lists
- List link sharing
- Rearranging items on your list
- Intelligent logon and redirection after logon
    <li>OAuth login with Google and social media applications
### Feedback:
   If you have feature suggestions or would like to report an issue, please send an email to me at <a href="mailto:feedback@horine.dev">feedback@horine.dev
   This information is incredibly valuable and much appreciated!
   <p>Thanks,</p>
   Zachary Horine

### Development:
   When developing, you will need to insert your credentials in a file named config.js. There is an example file to follow for format (exampleconfig.js). It should include the following, where user and pass are your username and password:
   ```
   host: "sql_server",
   user: "user",
   password: "pass",
   database: "recipes"
   ```
