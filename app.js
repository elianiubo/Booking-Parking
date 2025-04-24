import env, { parse } from "dotenv";
import express from "express";
import bodyParser from "body-parser";
import pg from "pg";
import ejs, { name } from "ejs";
import cron from "node-cron";
import nodemailer from "nodemailer"
import axios from "axios"
import Stripe from "stripe"
import session from 'express-session'
import { createInvoice } from "./public/createInvoice.js"






const app = express();
const PORT = 3000;
const YOUR_DOMAIN = 'http://localhost:3000';
let stripe; // Declare globally to make it accessible across the application



env.config();
const db = new pg.Client({
  user: process.env.PG_USER,
  host: process.env.PG_HOST,
  database: process.env.PG_DATABASE,
  password: process.env.PG_PASSWORD,
  port: process.env.PG_PORT,

});

// Function to connect to the database
async function connectDb() {
  try {
    await db.connect(); // Connect to PostgreSQL
    console.log('Connected to PostgreSQL');
  } catch (error) {
    console.error('Error connecting to PostgreSQL:', error);
    process.exit(1); // Exit if connection fails
  }
}

// Initialize connection before calling createInvoice
connectDb();

// Export dbClient to make it available for other modules
export { db };
//Use this when handling stripe key diffferently
//const stripe = new Stripe(process.env.STRIPE_KEY);
//console.log('Stripe Key:', process.env.STRIPE_KEY);

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));
app.use(express.json());


// Middleware for session handling
app.use(session({
  secret: process.env.SESSION_SECRET, // Use the retrieved session secret
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false }, // Set `true` if using HTTPS
}));

// Routes
app.get('/', async (req, res) => {
  try {
    const query = await db.query(`Select question, answer from faq`)
    // If no rows are returned, log an empty array for debugging
    const faqs = query.rows;
    const { address1, address2, address3, phone, contact_email } = await getEnvVariables();

    res.render('index.ejs', { totalPrice: 0, faqs, address1, address2, address3, phone, contact_email });

  } catch (error) {
    console.error('Error fetching FAQs:', error);
    res.status(500).send('Internal Server Error');
  }

});

// Route for rendering confirmation.ejs
app.get('/confirmation', async (req, res) => {
  const confirmationData = req.session.confirmationData;

  if (!confirmationData) {
    // return res.status(400).send('No confirmation data found.');
    return res.redirect('/')
  }
  const { name, bookingId, totalPrice } = confirmationData;
  const { address1, address2, address3, phone, contact_email } = await getEnvVariables();

  res.render('confirmation.ejs', {
    address1,
    address2,
    address3,
    phone,
    contact_email,
    name,
    bookingId,
    totalPrice,
  });
  // After rendering, clear the session confirmationData
  delete req.session.confirmationData;
});


//Gets stripe key from DB
(async () => {
  try {
    const { stripeKey } = await getEnvVariables(); // Retrieve Stripe key from DB
    stripe = new Stripe(stripeKey); // Initialize Stripe
    console.log('Stripe initialized successfully.');
  } catch (error) {
    console.error('Failed to initialize Stripe:', error.message);
    process.exit(1); // Exit if initialization fails
  }
})();

app.get('/cancel-booking', async (req, res) => {
  const { address1, address2, address3, phone, contact_email, cancelation_days } = await getEnvVariables();
  res.render('cancel-booking.ejs', { address1, address2, address3, phone, contact_email, cancelation_days });
})
//function that gets the env var from the database
async function getEnvVariables() {
  try {

    const query = `
        SELECT key_name, value 
        FROM env_variables 
        WHERE key_name = ANY($1)
      `;
    const requiredKeys = [
      'EMAIL', 'EMAIL_PASS', 'STRIPE_KEY', 'CANCEL_MINUTES',
      'address1', 'address2', 'address3', 'contact-email',
      'phone', 'SESSION_SECRET', 'kvk_number', 'vat_number', 'cancelation_days',
    ];

    const result = await db.query(query, [requiredKeys]);

    if (result.rows.length === 0) {
      throw new Error(`No environment variables found in the database.`);
    }
    // Transform results into a key-value object
    const envVariables = {};
    result.rows.forEach(row => {
      envVariables[row.key_name] = row.value;
    });

    // Return the variables with defaults if necessary
    return {
      emailOut: envVariables['EMAIL'],
      pass: envVariables['EMAIL_PASS'],
      stripeKey: envVariables['STRIPE_KEY'],
      cancel_minutes: parseInt(envVariables['CANCEL_MINUTES']),
      address1: envVariables['address1'],
      address2: envVariables['address2'],
      address3: envVariables['address3'],
      phone: envVariables['phone'],
      contact_email: envVariables['contact-email'],
      session_secret: envVariables['SESSION_SECRET'],
      kvk_number: envVariables['kvk_number'],
      vat_number: envVariables['vat_number'],
      cancelation_days: parseInt(envVariables['cancelation_days']),
    }

  } catch (error) {
    console.error('Error fetching environment variable:', error.message);
    throw error;
  }
}
function calculatetotalDays(arrival, departure) {
  const totalDays = Math.ceil((departure - arrival) / (1000 * 60 * 60 * 24)) + 1;
  return totalDays

}
// calculates total price that the price is used in 
function calculateTotalPrice(totalDays, basePrice, extraDayPrice, maxDays) {
  if (totalDays <= maxDays) {
    return parseFloat(basePrice.toFixed(2));
  }
  const extraDays = totalDays - maxDays;
  return parseFloat((basePrice + (extraDays * extraDayPrice)).toFixed(2));
}

async function getAvailableSlot(arrival_date, departure_date) {
  const query = `
    WITH booked_slots AS (
        SELECT DISTINCT slot
        FROM parking_bookings
        WHERE DATE(startdate) <= $2
          AND DATE(enddate) >= $1
          AND "status" != 'cancelled'
    )
    SELECT slot, base_price, extra_day_price, max_days
    FROM parking_slots
    WHERE slot NOT IN (SELECT slot FROM booked_slots)
    LIMIT 1;
  `;
  const values = [arrival_date, departure_date];
  return db.query(query, values);
}
//Funtion that gets user data and send the email wether is pending or confirmed booking
//the email format is also developed
async function sendMailConfirmation(data, action = 'confirmation') {
  console.log('Data received in sendMailConfirmation:', data);
  const { bookingId, name, sessionUrl, slot, email, arrival_date, departure_date,
    arrival_time, departure_time, totalPrice, totalDays, isPaid } = data;
  const formattedArrival = formatDate(arrival_date)
  const formattedDeparture = formatDate(departure_date)
  //console.log(formattedArrival + "    " + formattedDeparture)

  const { emailOut, pass, cancel_minutes } = await getEnvVariables(); // Fetch email and password from en variables
  // console.log("Email out in function send email is " + emailOut);
  // console.log("Pass in function send email is " + pass);
  // console.log("Time to cancel is " + cancel_minutes)
  if (!email || email.trim() === '') {
    console.error('Recipient email is invalid or missing.');
    return;
  }
  //console.log("Sending confirmation email to:", email);
  let pdfBuffer, subject, htmlCOntent = null;
  if (action === 'confirmation') {

    if (isPaid) {
      const query = 'SELECT pdf_data FROM invoices WHERE booking_id = $1';
      const result = await db.query(query, [bookingId]);
      if (result.rows.length === 0) {
        console.error(`No invoice found for booking ID: ${bookingId}`);
        return;
      }
      pdfBuffer = result.rows[0].pdf_data;
    }
    //format to add the text in minutes or hours in case of future chamnges in time in db
    //automatically adaps to minutes or hours the text
    let cancelTimeText;
    //checks wether is hours or minutes
    if (cancel_minutes >= 60) {
      const hours = Math.floor(cancel_minutes / 60);
      const minutes = cancel_minutes % 60;
      //Makes the text adding an s depending if is 1 or more hours and the same with minutes
      cancelTimeText = `${hours} hour${hours > 1 ? 's' : ''}${minutes > 0 ? ` and ${minutes} minute${minutes > 1 ? 's' : ''}` : ''}`;
    } else {
      cancelTimeText = `${cancel_minutes} minute${cancel_minutes > 1 ? 's' : ''}`;
    }

    //console.log("Formatted cancel time:", cancelTimeText);

    subject = `${isPaid ? 'Booking Confirmation ' : 'Booking Pending for Payment'}(Ref: EIN${bookingId})`;
    htmlCOntent = `
        <h1>${isPaid ? 'Booking Confirmation' : 'Booking Pending for Payment'}</h1>
      <p>Hello, ${name}!</p>
      <p>${isPaid
        ? `Your booking has been confirmed. Here are the details:`
        : `You have almost completed your booking. Please complete the payment to confirm.<br>
        <strong>You have ${cancelTimeText} to pay your booking, otherwise it will be cancelled.</strong>`}</p>
      <ul>
        <li><strong>Slot:</strong> ${slot}</li>
        <li><strong>Arrival Date:</strong> ${formattedArrival}</li>
        <li><strong>Arrival Date:</strong> ${formattedDeparture}</li>
        <li><strong>Arrival Time:</strong> ${arrival_time}</li>
        <li><strong>Departure Time:</strong> ${departure_time}</li>
        <li><strong>Days Booked:</strong> ${totalDays}</li>
        <li><strong>Total Price:</strong> €${totalPrice}</li>
      </ul>
      
      ${!isPaid
        ? `<p>Click the button below to complete your payment:</p>
           <p><strong>Please, make sure you pay within ${cancelTimeText} to confirm your booking.</strong></p>
           <p><a href="${sessionUrl}" style="display: inline-block; padding: 10px 20px; background-color: #28a745; color: white; text-decoration: none; border-radius: 5px;">Pay Now</a></p>
           <p>If the button does not work, you can use the following link:</p>
           <p><a href="${sessionUrl}">${sessionUrl}</a></p>`
        : `<p>Thank you for your payment. Your booking reference is <strong>EIN${bookingId}</strong>.</p>
        <p>Check our website if you need more information on where to find your parking spot in the contact section or check our FAQ section.</p>
          `}
          <p>${isPaid ? 'Kind Regards ' : 'Kind Regards'}</p>
    `;
  } else if (action === 'cancellation') {

    subject = `Booking Cancellation Confirmation for (Ref: EIN${bookingId})`
    htmlCOntent = `<h1>Booking Cancellation </h1>
        <p>Hello ${name},</p>
        <p> We confirm that your booking reference <strong> EIN${bookingId}</strong> has been successfully cancelled.</p>
        <p>You will recieve your money back between 3-5 business days.</p>
        <p>If you have any questions, please feel free to contact our support team.</p>
        <p>King regards</p>`
  } else if (action === 'pending-cancellation') {
    subject = `Pending Booking Cancellation Confirmation (Ref: EIN${bookingId})`;
    htmlCOntent = `
      <h1>Pending Booking Cancelled</h1>
      <p>Hello ${name},</p>
      <p>Your booking with reference <strong>EIN${bookingId}</strong> has been successfully cancelled.</p>
      <p>Since this booking was not yet confirmed with payment, no refund is required.</p>
      <p>If you have any questions, feel free to contact our support team.</p>
      <p>Kind regards,</p>
    `;
  }
  const transporter = nodemailer.createTransport({
    service: 'Gmail',
    auth: {
      user: emailOut,//'elia.nibu@gmail.com', //process.env.MAIL_USER,
      pass: pass//process.env.MAIL_PASS,
    },
  });
  const mailOptions = {
    from: emailOut,
    to: email,
    subject: subject,
    html: htmlCOntent,
    attachments: action === 'confirmation' && isPaid && pdfBuffer ? [
      {
        filename: `INV${bookingId}.pdf`,
        content: pdfBuffer,
        contentType: 'application/pdf'
      },
    ] : [] // No attachment pending for payments
  };
  transporter.sendMail(mailOptions, (error, info) => {
    if (error) {
      console.error('Error sending email:', error);
    } else {
      //console.log('Stripe session URL:', session.url);
      console.log('Email sent:', info.response);
    }
  });

}
//Route  to gandle the cancelarion of the bookings
app.post('/cancel-booking', async (req, res) => {
  const { ref_number: refNumber } = req.body; //gets ref number
  //console.log("Request body received:", req.body);
  if (!/^EIN\d+$/.test(refNumber)) { //if user input doesn't match the one in db
    console.log("Invalid REF number format:", refNumber);
    return res.status(400).json({ message: "Invalid REF number format. Use format 'EIN123'." });
  }
  const bookingId = parseInt(refNumber.replace('EIN', ''), 10);

  try {
    // Get booking details
    const result = await db.query(`
           SELECT 
        pb.id, 
        pb.status, 
        pb.payment_intent, 
        pb.total_price, 
        pb.startdate, 
        ub.name, 
        ub.email 
    FROM 
        parking_bookings pb
    INNER JOIN 
        user_bookings ub 
    ON 
        pb.id = ub.fk_parking_bookings_id 
    WHERE 
        pb.id = $1
      `, [bookingId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Booking not found." });
    }

    const booking = result.rows[0];
    console.log(booking)
    const startDate = new Date(booking.startdate); // Object Date
    const today = new Date();

    // Calculate days from arrival date
    const timeDifference = startDate - today;

    const daysUntilArrival = Math.ceil(timeDifference / (1000 * 60 * 60 * 24));// 
    console.log("Days until arrival:", daysUntilArrival);
    // Validar estado de la reserva
    if (booking.status === 'cancelled') {
      return res.status(400).json({ message: "This booking has already been cancelled." });
    }
    const { cancelation_days } = await getEnvVariables();
    //console.log("Cancel days " + cancelation_days + " today is " + today + " startd date is " + startDate)
    // Validar si faltan menos de 2 días
    if (daysUntilArrival < 0) {
      // Booking is already expired
      return res.status(400).json({
        message: "This booking has already expired.",
      });
    } else if (daysUntilArrival < cancelation_days) {
      // Booking is within the cancellation window
      return res.status(400).json({
        message: `You can only cancel a booking up to ${cancelation_days} days before the arrival date.`,
      })
    }
    const updateStatus = `UPDATE parking_bookings SET status = 'cancelled' WHERE id = $1`
    // Handle booking without `payment_intent` and status pending
    if (booking.status === 'pending' && !booking.payment_intent) {
      await db.query(updateStatus, [bookingId]);
      await sendMailConfirmation({
        bookingId: booking.id,
        name: booking.name,
        email: booking.email,
      }, 'pending-cancellation')
      return res.json({ status: 'cancelled', message: "Pending booking successfully cancelled. No refund needed, a confirmation email has been sent." });
    }

    const paymentIntent = await stripe.paymentIntents.retrieve(booking.payment_intent);
    //console.log("Retrieved Payment Intent:", paymentIntent);
    //If there was no payment intent
    if (!paymentIntent.latest_charge) {
      console.error("No charge associated with this payment intent:", booking.payment_intent);
      return res.status(400).json({ message: "No charges found for this booking's payment intent." });
    }

    // get the payment latest_charge
    const charge = await stripe.charges.retrieve(paymentIntent.latest_charge);
    console.log("Retrieved Charge:", charge);
    //refund custyomer if found
    if (charge.refunded) {
      await db.query(updateStatus, [bookingId]);
      return res.status(400).json({ message: "Payment already refunded." });
    }

    // make the refound
    await stripe.refunds.create({ charge: charge.id });
    console.log("Refund successful for charge:", charge.id);

    // update booking status
    await db.query(updateStatus, [bookingId]);

    await sendMailConfirmation({
      bookingId: booking.id,
      name: booking.name,
      email: booking.email,
    }, 'cancellation')

    return res.json({ status: 'cancelled', message: "Booking cancelled and payment refunded successfully. A confirmation email has been sent." });
  } catch (error) {
    console.error("Error cancelling booking:", error);
    return res.status(500).json({ message: "Internal server error. Please try again later." });
  }
});
//Make and inster in db user data
async function createBookingAndUserDetails(bookingData, userData, totalPrice, totalDays) {
  try {

    // Insert the booking data
    const bookingQuery = `
    INSERT INTO parking_bookings(startdate, enddate, slot, "status", created, total_price, total_days)
  VALUES($1, $2, $3, 'pending', NOW(), $4, $5)
    RETURNING id;
  `;
    const bookingResult = await db.query(bookingQuery, [...bookingData, totalPrice, totalDays]);
    const bookingId = bookingResult.rows[0].id; // Extract the booking ID

    // Step 2: Add bookingId to the userData array
    const userDataWithBookingId = [
      ...userData,
      bookingId // Append booking ID to userData
    ];
    //console.log('User data with bookingId:', userDataWithBookingId);

    // Insert the user booking data
    const userBookingQuery = `
     INSERT INTO user_bookings (
        parking_spot_id, name, email, arrival_date, departure_date, arrival_time, departure_time,
        car_brand, car_color, car_type, license_plate, 
        company_name, company_address, postal_code, city, country,kvk_number, vat_number ,fk_parking_bookings_id
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, 
       $8, $9, $10, $11, $12, 
       $13, $14, $15, $16, $17, $18, $19
     )RETURNING id;
   `;
    const userBookingResult = await db.query(userBookingQuery, userDataWithBookingId);

    return {
      bookingId,  // Return the actual booking ID
      userBookingId: userBookingResult.rows[0].id
    };

  } catch (error) {
    throw error;  // Rethrow the error for handling elsewhere
  }
}
//Create session for stripe payment
async function createSession({ bookingId, email, name, slot, totalPrice, totalDays, arrival_date, departure_date, arrival_time, departure_time, }) {
  try {
    if (!stripe) {
      throw new Error('Stripe is not initialized. Please check the setupStripe function.');
    }
    const { cancel_minutes } = await getEnvVariables()
    console.log("Cancel Duration from DB:", cancel_minutes);
   
    const query = `select created from parking_bookings where id = $1`
    const result = await db.query(query, [bookingId])
    //console.log("ID from the creted from db" + bookingId)
    if (result.rows.length === 0) {
      throw new Error('No data found with the given ID');
    }

    const createdDate = result.rows[0].created;

    // https://docs.stripe.com/payment-links/api
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['ideal']['card'],
      line_items: [
        {
          price_data: {
            currency: 'eur',
            product_data: { name: `Payment for Parking Space ref EIN${bookingId} ` },
            unit_amount: Math.round(totalPrice * 100),
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: `http://localhost:3000/payment-success?session_id={CHECKOUT_SESSION_ID}`,
      //it expires at 30 min CHANGE TO 2 HOURS IN THE FUTURE
      expires_at: Math.floor((new Date(createdDate).getTime() + cancel_minutes * 60 * 1000) / 1000), // Expire in 30 minutes

      client_reference_id: bookingId,
    });



    //https://docs.stripe.com/payments/checkout/managing-limited-inventory#setting-an-expiration-time
    console.log(bookingId + "and slot" + slot)
    // Send email confirmation with payment link
    sendMailConfirmation({
      bookingId,
      email,
      name,
      sessionUrl: session.url,
      slot,
      arrival_date,
      departure_date,
      arrival_time,
      departure_time,
      totalDays,
      totalPrice,
    });
    console.log("session id: " + session.id)
    return { sessionUrl: session.url };
  } catch (err) {
    console.error('Error in handlePayment:', err);
    throw new Error('Payment setup failed');
  }
}


//GETS THE USER DATA AND CHECKS IF THERS AN AVALIABLE SLOT ON SELECTED INPUTS AND DATES
//IF THERE IS, A BOOKING PROCEES IS MADE
app.post('/book', async (req, res) => {

  const {
    arrival_date, departure_date, arrival_time, departure_time,
    name, email, car_brand, car_color, car_type, license_plate,
    company_name, company_address, postal_code, city, country, kvk_number, vat_number
  } = req.body;
  try {
    const arrival = new Date(arrival_date);
    const departure = new Date(departure_date);
    
    const totalDays = calculatetotalDays(arrival, departure)
    console.log(totalDays)
    //AVALIABLE SLOT not FOUND
    const availableSlotResult = await getAvailableSlot(arrival_date, departure_date);
    if (availableSlotResult.rows.length === 0) {
      return res.status(400).json({ message: 'No spots available for the selected dates' });
    }

    //avaliable slot found and save it to calculate total price
    const { slot: availableSlot, base_price, extra_day_price, max_days } = availableSlotResult.rows[0];
    const totalPrice = calculateTotalPrice(totalDays, parseFloat(base_price), parseFloat(extra_day_price), parseInt(max_days, 10));
    //data is saved of the booking and user to insert it into the db
    const bookingData = [`${arrival_date} 00:00:00`, `${departure_date} 23:59:59`, availableSlot];
    const userData = [
      availableSlot, name, email, arrival_date, departure_date, arrival_time, departure_time,
      car_brand, car_color, car_type, license_plate, // Ensure bookingId is added here
      company_name, company_address, postal_code, city, country, kvk_number, vat_number
    ];

    //calls the function to create a booking and insert users to db by the bookig id
    const { bookingId } = await createBookingAndUserDetails(bookingData, userData, totalPrice, totalDays);

    //calls a function to make the payment
    const { sessionUrl } = await createSession({
      bookingId,
      email,
      name,
      slot: availableSlot,
      totalPrice,
      totalDays,
      arrival_date,
      departure_date,
      arrival_time,
      departure_time,
      isPaid: false
    });   
    res.json({ bookingId, sessionUrl, parking_spot_id: availableSlot, totalPrice, name, totalDays });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error checking availability or booking');
  }
});

app.post('/check-availability', async (req, res) => {
  const { arrival_date, departure_date } = req.body;

  try {
    const availableSlotResult = await getAvailableSlot(arrival_date, departure_date);

    if (availableSlotResult.rows.length === 0) {
      return res.json({ available: false });
    }

    const { base_price, extra_day_price, max_days } = availableSlotResult.rows[0];
    const arrival = new Date(arrival_date);
    const departure = new Date(departure_date);
    const totalDays = calculatetotalDays(arrival, departure)

    const totalPrice = calculateTotalPrice(totalDays, parseFloat(base_price), parseFloat(extra_day_price), parseInt(max_days, 10));
    res.json({ available: true, totalPrice, totalDays });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error checking availability' });
  }
});
app.post('/check-pending', async (req, res) => {
  try {
    //I get the minutes from function
    const { cancel_minutes } = await getEnvVariables();
    if (!cancel_minutes) {
      throw new Error('Cancel time not defined or invalid');
    }
    
    //link explains the CAST
    //https://neon.tech/postgresql/postgresql-tutorial/postgresql-cast
    const query = `
  UPDATE parking_bookings
  SET "status" = 'cancelled'
  WHERE "status" = 'pending'
    AND created < NOW() - (CAST($1 || ' minutes' AS INTERVAL))
  RETURNING id;
`;
    const result = await db.query(query, [cancel_minutes]);
    console.log("The minutes after pending cancelled are" + cancel_minutes)

    if (result.rows.length > 0) {
      console.log('Cancelled bookings:', result.rows.map(row => row.id));
      res.status(200).json({ message: 'Pending bookings cancelled', cancelledIds: result.rows.map(row => row.id) });
    } else {
      console.log('No pending bookings to cancel.');
      res.status(200).json({ message: 'No pending bookings to cancel' });
    }
  } catch (error) {
    console.error('Error in check-pending:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});
//If poayment was completed from the session link
app.get('/payment-success', async (req, res) => {
  const sessionId = req.query.session_id;
  console.log('Session ID received:', sessionId);

  if (!sessionId) {
    return res.status(404).send('Missing session Id');
  }
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (!session) {
      return res.status(404).send('Session not found');
    }

    const bookingId = session.client_reference_id;
    const paymentIntentId = session.payment_intent;
    console.log("booking id" + bookingId)
    console.log("payment_intent" + paymentIntentId)

    // // Fetch booking details from the database using the booking ID
    const query = `       
      SELECT ub.parking_spot_id, ub.name, ub.email, ub.arrival_date, ub.departure_date, ub.arrival_time,ub.departure_time, 
      ub.fk_parking_bookings_id, pb.total_price, pb.email_sent, pb.total_days, ub.company_name, ub.company_address, ub.postal_code, ub.city, ub.country,
      ub.kvk_number, ub.vat_number
      FROM user_bookings ub
      JOIN parking_bookings pb ON pb.id = ub.fk_parking_bookings_id
      WHERE ub.fk_parking_bookings_id = $1
        `;

    const result = await db.query(query, [bookingId]);

    // Actualiza el estado de la reserva en la base de datos
    const update = ` UPDATE parking_bookings 
      SET payment_intent = $1, status = 'confirmed' 
      WHERE id = $2;`;
    await db.query(update, [paymentIntentId, bookingId]); // Asegúrate de enviar un ID correcto aquí
    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Booking not found' });
    }
    //const { bookingId, name, sessionUrl, slot, email, arrival_date, departure_date, totalPrice, isPaid } = data;
    const booking = result.rows[0];
    const totalPrice = parseFloat(result.rows[0].total_price);
    // console.log('Booking details from database:', booking);
   
    // Generate and save invoice to the database
    console.log("Booking Data booking:", booking); // Log the full booking object
    console.log("Total Price:", booking.total_price); // Log total_price specifically

    //getEnvVariables like address and kvk vat number
    const { address1, address2, address3, kvk_number, vat_number } = await getEnvVariables();
    // Generate a new unique invoice number
    console.log('Environment Variables:', {
      address1,
      address2,
      address3,
      kvk_number,
      vat_number
    });

    const invoiceNumber = `INV${bookingId}`;
    await createInvoice({
      bookingId,
      name: booking.name,
      email: booking.email,
      address1,
      address2,
      address3,
      kvk_number,
      vat_number,
      bookings: [
        {
          description: 'Parking Reservation',
          totalDays: booking.total_days,
          totalAmount: totalPrice,
        },

      ],
      totalPrice,
      invoiceNumber, // Example invoice number, could be a generated value
      invoiceDate: formatDate(new Date), // Use current date for invoice date
      companyKvk: booking.kvk_number || null, // Include only if available
      companyVat: booking.vat_number || null, // Include only if available
      companyName: booking.company_name || null, // Include only if available
      companyAddress: [booking.company_address, booking.postal_code, booking.city, booking.country]
        .filter(Boolean) // Remove any `null`, `undefined`, or empty values
        .join(", ") || null,
      grandTotal: totalPrice, // Assuming grandTotal is same as totalPrice

    }, db);
    console.log('Invoice Data: after craete invoice dirst Vat company second vat user', {
      vat_number,
      kvk_number,
      address1,
      address2,
      address3,
      companyKvk: booking.kvk_number,
      companyVat: booking.vat_number
    });

    sendMailConfirmation({
      bookingId: booking.fk_parking_bookings_id,
      name: booking.name,
      slot: booking.parking_spot_id, // Corrected the property name
      email: booking.email,
      arrival_date: booking.arrival_date,
      departure_date: booking.departure_date,
      arrival_time: booking.arrival_time,
      departure_time: booking.departure_time,
      totalDays: booking.total_days,
      totalPrice: booking.total_price,
      isPaid: true,
    });
    // Update the `email_sent` flag in the database
    const updateQuery = `UPDATE parking_bookings SET email_sent = TRUE WHERE id = $1`;
    await db.query(updateQuery, [bookingId]);
    console.log("Confirmation Data in session: ", req.session.confirmationData);

    // Save any data you want to display in the confirmation page in the session
    req.session.confirmationData = {
      name: booking.name,
      bookingId,
      totalPrice,
    };

    // Redirect to a clean URL
    //uses session key to save cookies
    res.redirect('/confirmation');
  } catch (error) {
    console.error('Error retrieving session:', error);
    res.status(500).send('Error retrieving payment session');
  }
});


function formatDate(date) {
  if (!date || isNaN(new Date(date).getTime())) {
    console.error('Invalid date passed to formatDate:', date);
    return '';
  }
  //It shows full date which is more user frendly
  const options = { dateStyle: 'full' }
  //It shows DD/MM/YY
  // const options = { day: '2-digit', month: '2-digit', year: 'numeric' };
  return new Intl.DateTimeFormat('en-GB', options).format(new Date(date));
}

//every 5 min updates and checks endpoint check-bookings to update bookings
// Scheduled Task
cron.schedule('*/5 * * * *', async () => {
  try {
    await axios.post('http://localhost:3000/check-pending');
    console.log('Checked pending bookings');
  } catch (error) {
    console.error('Error running scheduled task:', error);
  }
});


// Start Server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
