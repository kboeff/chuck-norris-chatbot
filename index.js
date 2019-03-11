'use strict';

// Facebook code below, setting up the webhook for Messenger
// Imports dependencies and set up http server
const request = require('request');
const fetch = require('node-fetch');
const express = require('express');
const bodyParser = require('body-parser');
const app = express().use(bodyParser.json()); // creates express server
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const { Client } = require('pg'); // connect to PostgreSQL

// Connect to the database 
const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: true,
});

client.connect();

// Sets server port and logs message on success
app.listen(process.env.PORT || 1337, () => console.log('webhook is listening'));

// Creates the endpoint for our webhook 
app.post('/webhook', (req, res) => {  
 
    let body = req.body;
  
    // Checks this is an event from a page subscription
    if (body.object === 'page') {
  
      // Iterates over each entry - there may be multiple if batched
      body.entry.forEach(function(entry) {
  
        // Gets the message. entry.messaging is an array, but 
        // will only ever contain one message, so we get index 0
        let webhook_event = entry.messaging[0];
        console.log(webhook_event);

        // Get the sender PSID
        let sender_psid = webhook_event.sender.id;
        console.log('Sender PSID: ' + sender_psid);

        // Get the Timestamp
        let time_stamp = webhook_event.timestamp;

        // Check if the event is a message or postback and
        // pass the event to the appropriate handler function
        // NOTE: NOT USING POSTBACKS CURRENTLY
        if (webhook_event.message) {
            handleMessage(sender_psid, time_stamp, webhook_event.message);        
        } else if (webhook_event.postback) {
            console.log(webhook_event.postback.payload);
        }

      });
  
      // Returns a '200 OK' response to all requests
      res.status(200).send('EVENT_RECEIVED');
    } else {
      // Returns a '404 Not Found' if event is not from a page subscription
      res.sendStatus(404);
    }
  
  });

app.get('/webhook', (req, res) => {
    // Your verify token. Should be a random string.
    let VERIFY_TOKEN = PAGE_ACCESS_TOKEN;

    // Parse the query params
    let mode = req.query['hub.mode'];
    let token = req.query['hub.verify_token'];
    let challenge = req.query['hub.challenge'];

    // Checks if a token and mode is in the query string of the request
    if (mode && token) {

        // Checks the mode and token sent is correct
        if (mode === 'subscribe' && token === VERIFY_TOKEN) {

            // Responds with the challenge token from the request
            console.log('WEBHOOK_VERIFIED');
            res.status(200).send(challenge);
        } else {
            // Responds with '403 Forbidden' if verify tokens do not match
            res.sendStatus(403);
        }
    }
});

// Handles messages events
function handleMessage(sender_psid, time_stamp, received_message) {
    let response;
    let joke;
    let helpMessage = 'Help: ask for a Joke and then you will want some More. Type Reset if you get stuck.';
    let hint = 'Hint: ask for help to get instructions.';

    // Fetch the joke
    fetch('http://api.icndb.com/jokes/random/')
        .then(res => res.json())
        .then(json => { joke = json["value"]["joke"]});
    
    // Checks if the message contains text
  if (received_message.text) {    
    // Create the payload for a basic text message, which
    // will be added to the body of our request to the Send API
    let userStatus = dbCheck(sender_psid, time_stamp);
    console.log('userStatus', userStatus);
    // Remove punctuation to search for keywords in user message
    let cleanMessage = received_message.text.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g,"").toLowerCase().split(' ');
   
    if (cleanMessage.indexOf('joke') !== -1) {
        if (userStatus >= 0) {
            console.log('response = joke');
            // New user found, check wether he or she wants a joke
            response = joke;
            if(userStatus === 0) {
                addNewUser(sender_psid, time_stamp);
            } else {
                updateUser(sender_psid);
            }
        }
   } else if (cleanMessage.indexOf('more') !== -1) {
       if (userStatus === 2) {
           response = joke;
           updateUser(sender_psid);
       }
   } else if (cleanMessage.indexOf('help') !== -1) {
       response = helpMessage;
   } else if (cleanMessage.indexOf('reset') !== -1) {
       resetUser(sender_psid);
   } else {
       response = hint;
   }

  } else if (received_message.attachments.length) {
    // Get the URL of the message attachment
    // let attachment_url = received_message.attachments[0].payload.url;
    response = 'Nice picture, do you want to know what Chuck Norris has to say about it?';
  }

    // Sends the response message
    callSendAPI(sender_psid, response); 
}

// Sends response messages via the Send API
function callSendAPI(sender_psid, response) {
  // Construct the message body
  let request_body = {
    "recipient": {
      "id": sender_psid
    },
    "message": response
  };

  // Send the HTTP request to the Messenger Platform
  request({
    "uri": "https://graph.facebook.com/v2.6/me/messages",
    "qs": { "access_token": PAGE_ACCESS_TOKEN },
    "method": "POST",
    "json": request_body
  }, (err, res, body) => {
    if (!err) {
      console.log(res, body, 'message sent!');
    } else {
      console.error("Unable to send message:" + err);
    }
  }); 
}

// Check if the user exists in the database and other conditions
// return values according to different scenarios:
// -2 => post count over 10, check elapsed time
// -1 => just reached 10 posts, have to wait 24 hours
//  0 => user not found, needs to be added
//  1 => waiting time over or reset found, show a joke
//  2 => hear a joke, could ask for more 
function dbCheck(sender_psid, time_stamp) {
    let state = 0;
    client.query('SELECT status, starttime, count, heard_a_joke FROM records WHERE id=$1;', [sender_psid] , (err, res) => {
        if (err) {
            throw err = new Error('Cannot connect to PostgreSQL.');
        }
        // console.log(res, res.rows);
        if (res.rows.length > 0) {
            let { status, stamp, count, heard_a_joke } = JSON.stringify(res.rows);
            let receivedDate = new Date(stamp * 1000);
            let timePassed = new Date() - receivedDate;

            // console.log(res.rows);
            if (status === -1) {
                if (timePassed < 24 * 60 * 60 * 1000) {
                    state = -2; // post count over 10, need to wait 24 hours
                } else {
                    client.query('UPDATE records SET status = 0, count = 0 WHERE id=$1;', [sender_psid] , (err, res) => {
                        if (err) {
                            throw err = new Error('Cannot UPDATE records');
                        }
                        console.log(res.rows);
                    });
                    state = 1;
                }
            }
            if (count > 10) {
                client.query('UPDATE records SET status = -1, count = 0, starttime = $2 WHERE id=$1;', [sender_psid, time_stamp] , (err, res) => {
                    if (err) {
                        throw err = new Error('Cannot UPDATE records..');
                    }
                    console.log(res.rows);
                });
                state = -1;
            }
            if (heard_a_joke) {
                state = 2;
            } else {
                state = 1;
            }
        } else {
            state = 0;
        }
        
    });
    return state;
}

// Add new user, start counting
function addNewUser(sender_psid, time_stamp) {
    client.query('INSERT INTO records (id, status, starttime, count, heard_a_joke) VALUES ($1, 1, to_timestamp($2), 1, FALSE);', [parseInt(sender_psid), Date(time_stamp)/1000] , (err, res) => {
        if (err) {
            throw err = new Error('Problem inserting to db.');
        }
        console.log(JSON.stringify(res.rows));
    });
}

// Increment count from 1 to 10
function updateUser(sender_psid) {

    client.query('UPDATE records SET count = count + 1, heard_a_joke = TRUE WHERE id=$1;', [sender_psid] , (err, res) => {
        if (err) {
            throw err;
        }
        console.log(JSON.stringify(res.rows));
    });
}


// Reset counts and heard_a_joke
function resetUser(sender_psid) {
    client.query('UPDATE records SET status = 0, count = 0, heard_a_joke = FALSE WHERE id=$1;', [sender_psid] , (err, res) => {
        if (err) {
            throw err;
        }
        console.log(JSON.stringify(res.rows));
    });
}