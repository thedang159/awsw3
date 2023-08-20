const express = require("express");
const cookieParser = require("cookie-parser");
const sessions = require("express-session");
const http = require("http");
var parseUrl = require("body-parser");
const app = express();
const AWS = require("aws-sdk");
const sqs = new AWS.SQS({ region: process.env.REGION || "ap-northeast-1" });
const { Resend } = require("resend");
const resend = new Resend("re_VAdMAwbx_NfyFiajjmpc9kaWXZNFzZGWh");
const sgMail = require("@sendgrid/mail");
var mysql = require("mysql");
const Pusher = require("pusher");
const { v4: uuidv4 } = require("uuid");
var isQueue = false;

require("dotenv").config();

const pusher = new Pusher({
  appId: process.env.PUSHER_APP_ID,
  key: process.env.PUSHER_KEY,
  secret: process.env.PUSHER_SECRET,
  cluster: process.env.PUSHER_CLUSTER,
  useTLS: true,
});

let encodeUrl = parseUrl.urlencoded({ extended: false });

const MAIL_ADMIN = process.env.MAIL_ADMIN;

const creds = new AWS.SharedIniFileCredentials({ profile: "default" });
const sns = new AWS.SNS({
  creds,
  region: process.env.REGION || "ap-northeast-1",
});

app.use(
  sessions({
    secret: "thisismysecrctekey",
    saveUninitialized: true,
    cookie: { maxAge: 1000 * 60 * 60 * 24 }, // 24 hours
    resave: false,
  })
);

app.use(cookieParser());

var con = mysql.createConnection({
  host: process.env.host || "localhost",
  user: process.env.user || "root",
  password: process.env.password || "password",
  database: process.env.database || "mydb",
});

app.get("/", (req, res) => {
  res.sendFile(__dirname + "/page/register.html");
});

app.post("/register", encodeUrl, (req, res) => {
  var email = req.body.email;
  var firstName = req.body.firstName;
  var lastName = req.body.lastName;
  var userName = req.body.userName;
  var password = req.body.password;

  let params = {
    Subject: "Register user confirm",
    Message: req.body.email,
    TopicArn: process.env.TOPICARN,
  };
  con.connect(function (err) {
    if (err) {
      console.log(err);
    }
    con.query(
      `SELECT * FROM users WHERE email = '${email}'`,
      function (err, result) {
        if (err) {
          console.log(err);
        }
        if (Object.keys(result).length > 0) {
          res.sendFile(__dirname + "/page/failReg.html");
        } else {
          function userPage() {
            req.session.user = {
              email: email,
              firstname: firstName,
              lastname: lastName,
              username: userName,
              password: password,
            };

            sns.publish(params, (err, data) => {
              if (err) console.error(err);
            });

            res.send(`
                <!DOCTYPE html>
                <html lang="en">
                <head>
                    <title>Demo week 2</title>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1">
                    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.1.3/dist/css/bootstrap.min.css" rel="stylesheet">
                </head>
                <body>
                    <div class="container">
                        <h3>Hi, ${req.session.user.firstname} ${req.session.user.lastname}</h3>
                        <a href="/">Log out</a>
                    </div>
                </body>
                </html>
                `);
          }
          var sql = `INSERT INTO users (email, firstname, lastname, username, password, status) VALUES ('${email}', '${firstName}', '${lastName}', '${userName}', '${password}', 'invited')`;
          con.query(sql, function (err, result) {
            if (err) {
              console.log(err);
            } else {
              userPage();
            }
          });
        }
      }
    );
  });
});

app.get("/login", (req, res) => {
  res.sendFile(__dirname + "/page/login.html");
});

app.post("/dashboard", encodeUrl, (req, res) => {
  var email = req.body.email;
  var password = req.body.password;

  con.connect(function (err) {
    if (err) {
      console.log(err);
    }
    con.query(
      `SELECT * FROM users WHERE email = '${email}' AND password = '${password}'`,
      function (err, result) {
        if (err) {
          console.log(err);
        }
        function userPage() {
          req.session.user = {
            email: result[0].email,
            firstname: result[0].firstname,
            lastname: result[0].lastname,
            username: result[0].username,
            password: password,
          };

          var sql = `UPDATE users SET status = 'active' WHERE email='${email}'`;

          con.query(sql, function (err, result) {
            if (err) {
              console.log(err);
            } else {
              res.send(`
                        <!DOCTYPE html>
                        <html lang="en">
                        <head>
                            <title>Demo week 2</title>
                            <meta charset="UTF-8">
                            <meta name="viewport" content="width=device-width, initial-scale=1">
                            <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.1.3/dist/css/bootstrap.min.css" rel="stylesheet">
                        </head>
                        <body>
                            <div class="container">
                                <h3>Hi, ${req.session.user.firstname} ${req.session.user.lastname}</h3>
                                <a href="/">Log out</a>
                            </div>
                        </body>
                        </html>
                        `);
            }
          });
        }

        if (Object.keys(result).length > 0) {
          userPage();
        } else {
          res.sendFile(__dirname + "/page/failLog.html");
        }
      }
    );
  });
});

const params = {
  QueueUrl: process.env.QUEUEURL,
  MaxNumberOfMessages: 10,
  VisibilityTimeout: 30,
  WaitTimeSeconds: 20,
};

const poll = async () => {
  if (!isQueue) {
    isQueue = true;
    console.log("Polling SQS");
    const nextPollingTime = 60000;
    sqs.receiveMessage(params, (err, data) => {
      if (err) {
        console.error(err);
      } else {
        if (data?.Messages?.length) {
          console.log(`Received ${data.Messages?.length} messages:`);
          data?.Messages.forEach(async (message) => {
            const mes = JSON.parse(message.Body);
            console.log(`- ${mes.Message}`);

            //send mail admin
            const data = await resend.emails.send({
              from: "Acme <onboarding@resend.dev>",
              to: [MAIL_ADMIN],
              subject: "Demo week 2",
              html: `<strong>User register: ${mes.Message}</strong>`,
            });

            sgMail.setApiKey(process.env.SENDGRID_API_KEY);
            const msg = {
              to: mes.Message,
              from: process.env.MAIL_FROM,
              subject: "Welcome",
              text: "Login LinK: http://localhost:4000/login",
              html: "<strong>Login LinK: <a href='http://localhost:4000/login'>http://localhost:4000/login</a></strong>",
            };

            try {
              await sgMail.send(msg);
            } catch (error) {
              console.error(error);

              if (error.response) {
                console.error(error.response.body);
              }
            }

            pusher.trigger(`channel-${uuidv4()}`, "my-event", {
              message: `Welcome to Demo!`,
            });

            const deleteParams = {
              QueueUrl: process.env.QUEUEURL,
              ReceiptHandle: message.ReceiptHandle,
            };

            sqs.deleteMessage(deleteParams, function (err, data) {
              if (err) console.log(err, err.stack);
              else console.log(data);
            });
          });
          console.log("Done SQS");
        } else {
          console.log("None SQS");
        }
      }
    });
    isQueue = false;
    setTimeout(() => poll(), nextPollingTime);
  }
};
poll();

app.listen(process.env.PORT, () => {
  console.log("Server running on port 4000");
});
