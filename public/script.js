document.addEventListener("DOMContentLoaded", () => {


  // this make that once i've recieved the confrimation email, and i reload the page it goes to the main page again, to avoid sneding emails again wiht onfirmation
  if (window.performance.getEntriesByType("navigation")[0].type === 'reload') {
    window.location.href = '/';
  }

  const arrivalDateInput = document.getElementById('arrival_date');
  const departureDateInput = document.getElementById('departure_date');
  const submitButton = document.getElementById('submit-btn');
  disablePastDates();  // Disable past dates for arrival date on page load
  updatePage();
  const faqs = document.querySelectorAll(".faq");  // Select all the FAQ items

  faqs.forEach(faq => {
    const arrow = faq.querySelector(".arrow-icon");  // Get the arrow inside the FAQ
    // Add click event listener to the entire FAQ element
    faq.addEventListener("click", function () {
      // Toggle the 'active' class on the FAQ container to show/hide the answer
      faq.classList.toggle("active");

      // Rotate the arrow icon
      arrow.classList.toggle("rotate");
    });
  })



  // Create the span element for total price dynamically
  function disablePastDates() {
    const today = new Date();
    const dd = String(today.getDate()).padStart(2, '0');
    const mm = String(today.getMonth() + 1).padStart(2, '0'); // January is 0
    const yyyy = today.getFullYear();
    const formattedToday = `${yyyy}-${mm}-${dd}`;

    if (arrivalDateInput) {
      arrivalDateInput.setAttribute("min", formattedToday);
    }
  }
  //SHows error when function is called the message is writtten 
  //in when the function is called to a nother function
  function showErrors(element, message) {
    if (element) {
      element.style.display = message ? 'block' : 'none';
      element.innerText = message || '';
    }

  }
  const optionError = document.getElementById("option-error");
  const selectElement = document.getElementById('select-option');
  const companySection = document.getElementById('company-section');
  const formInputs = document.querySelectorAll('input[required]'); // All required input fields
  //VAlidate input formatiing
  function validateForm() {
    let isValid = true;

    // Name validation
    const nameInput = document.getElementById("name");
    const nameError = document.getElementById("name-error");

    if (/\d/.test(nameInput.value)) {
      showErrors(nameError, "Name isn't correct");
      isValid = false; // Invalid name
    }

    // Email validation
    const emailInput = document.getElementById("email");
    const emailError = document.getElementById("email-error");
    // Check whether it has an email format
    if (!emailInput.value.trim()) {
      showErrors(emailError, "Email is required");
      isValid = false; // Invalid email
    } else if (!/^\S+@\S+\.\S+$/.test(emailInput.value)) {
      showErrors(emailError, "Please enter a valid email address");
      isValid = false; // Invalid email
    } else {
      showErrors(emailError, ''); // Clear error
    }

    // Validate arrival and departure time
    const arrivalTimeInput = document.getElementById("arrival_time").value;
    const departureTimeInput = document.getElementById("departure_time").value;
    const departureError = document.getElementById("departure-error");

    const arrivalDate = arrivalDateInput.value;
    const departureDate = departureDateInput.value;

    // Create valid Date objects for arrival and departure
    const arrivalDateTimeString = `${arrivalDate}T${arrivalTimeInput}:00`; // Combining date and time
    const departureDateTimeString = `${departureDate}T${departureTimeInput}:00`;

    const arrivalDateTimeFormat = new Date(arrivalDateTimeString);
    const departureDateTimeFormat = new Date(departureDateTimeString);

    // If arrival date and departure date are on the same day (one-day parking only), show error message
    if (arrivalDate === departureDate) {
      // Show error message if departure time is earlier than or the same as arrival time on the same day
      if (departureDateTimeFormat <= arrivalDateTimeFormat) {
        showErrors(departureError, "Departure time can't be before or the same as the arrival time");
        isValid = false; // Invalid departure time
      } else {
        showErrors(departureError, "");
      }
    }

    // Car brand values validation
    const brandInput = document.getElementById("car_brand");
    const brandError = document.getElementById("brand-error");
    // Car color values validation
    const colorInput = document.getElementById("car_color");
    const colorError = document.getElementById("color-error");
    // Car type values validation
    const typeInput = document.getElementById("car_type");
    const typeError = document.getElementById("type-error");

    if (/\d/.test(brandInput.value)) {
      showErrors(brandError, "Car brand isn't correct");
      isValid = false; // Invalid car brand
    }
    if (/\d/.test(colorInput.value)) {
      showErrors(colorError, "Car color isn't correct");
      isValid = false; // Invalid car color
    }
    if (/\d/.test(typeInput.value)) {
      showErrors(typeError, "Car type isn't correct");
      isValid = false; // Invalid car type
    }

    // Dropdown validation
    if (selectElement.value === '0') { // No option selected
      showErrors(optionError, "Please choose an option.");
      isValid = false;
    }
    if (selectElement.value === '1' || selectElement.value === '2') { // "Yes" or "No" selected
      showErrors(optionError, ""); // Clear the error
    }


    // Validate company section only if "Yes" is selected
    if (selectElement.value === '1') { // "Yes" selected
      companySection.querySelectorAll('input[required]').forEach(input => {
        const errorElement = input.nextElementSibling;
        if (!input.value.trim()) {
          showErrors(errorElement, `${input.placeholder} is required`);
          isValid = false;
        } else {
          showErrors(errorElement, "");
        }
      });
    }


    return isValid;
  }


  // Function to validate all inputs
  const validateInputs = () => {
    let allInputsValid = true;

    formInputs.forEach(input => {
      input.addEventListener('input', () => {
        const errorElement = input.nextElementSibling;
        if (errorElement) {
          showErrors(errorElement, ""); // Clear errors dynamically
        }
      });
    });

    return allInputsValid;
  };

  const handleDropdownChange = () => {
    if (selectElement.value === '1') { // "Yes" selected
      companySection.style.display = 'block'; // Show company section
      if (selectElement.value === '1' || selectElement.value === '2') { // "Yes" or "No" selected
        showErrors(optionError, ""); // Clear the error
      }
      companySection.querySelectorAll('input').forEach(input => input.removeAttribute('disabled'));
    } else { // "No" selected
      companySection.style.display = 'none'; // Hide company section
      companySection.querySelectorAll('input').forEach(input => {
        input.setAttribute('disabled', 'disabled');
        const errorElement = input.nextElementSibling;
        if (errorElement) {
          showErrors(errorElement, ""); // Clear errors
        }
      });
    }
  };
  //checks avaliability of parking slots when selected
  async function checkAvailability() {
    const arrivDate = arrivalDateInput.value;
    const depDate = departureDateInput.value;
    const selectedDates = document.getElementById("Selected-dates");
    const priceDisplay = document.getElementById("price-display");
    const daysDisplay = document.getElementById("days-display");

    // Reset price and days display initially
    selectedDates.textContent = ""; // Clear any previous messages
    priceDisplay.textContent = "Total Price € 0"; // Ensure the initial text is correct
    daysDisplay.textContent = "Total days reserved: 0"; // Ensure the initial days display is correct
    submitButton.disabled = true; // Disable submit button by default
    priceDisplay.style.color = '#555'; // Reset the price display
    daysDisplay.style.color = '#555';
    console.log("Arrival Date:", arrivDate, "Departure Date:", depDate);

    // Ensure departure date is after arrival date by setting the min value for departure
    if (arrivDate) {
      departureDateInput.setAttribute("min", arrivDate); // Prevent earlier dates for departure
    }

    // If both dates are selected, check if departure is before arrival
    if (arrivDate && depDate) {
      if (depDate < arrivDate) {
        departureDateInput.value = ""; // Clear invalid departure date
        priceDisplay.textContent = "Total Price € 0"; // Reset the price display
        daysDisplay.textContent = "Total days reserved: 0"; // Reset days display
        submitButton.disabled = true; // Disable submit button
        priceDisplay.style.color = '#555'; // Reset the price display
        daysDisplay.style.color = '#555';
        departureDateInput.setAttribute("min", arrivDate); // Ensure departure date can't be before arrival date
        return; // Exit early
      }
    }

    // Proceed only if both arrival and departure dates are valid and selected
    if (!arrivDate || !depDate) {
      priceDisplay.textContent = "Total Price € 0"; // Reset the price display
      daysDisplay.textContent = "Total days reserved: 0"; // Reset days display
      priceDisplay.style.color = '#555'; // Reset the price display
      daysDisplay.style.color = '#555';

      submitButton.disabled = true; // Disable submit button
      return; // Exit early
    }

    try {
      // Call the endpoint to check availability
      const response = await fetch("/check-availability", {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ arrival_date: arrivDate, departure_date: depDate })
      });

      const result = await response.json();

      if (result.available) {
        // const totalDays = showTotalDays(arrivDate, depDate); // Calculate total days
        priceDisplay.style.color = "#555"
        priceDisplay.textContent = `Total Price € ${result.totalPrice}`; // Update the price display
        daysDisplay.textContent = `Total days reserved: ${result.totalDays}`; // Update the days display
        submitButton.disabled = false; // Enable the submit button

      } else {
        // If dates are not available
        selectedDates.textContent =
          "Selected dates are not available. Please choose different dates."; // Show error in selected-dates
        priceDisplay.textContent = "";
        daysDisplay.textContent = ""; // Reset the days display
        submitButton.disabled = true; // Disable submit button
      }
    } catch (error) {
      console.error("Error checking availability:", error);
      priceDisplay.textContent = "Error checking availability"; // Show error message
      daysDisplay.textContent = "Total days reserved: 0"; // Reset the days display
      priceDisplay.style.color = "red"; // Change color to red for error
      submitButton.disabled = true; // Disable submit button
    }
    // Ensure text wraps and does not overflow
    selectedDates.style.whiteSpace = "normal"; // Allow wrapping
    selectedDates.style.wordWrap = "break-word"; // Break long text properly
    selectedDates.style.overflowWrap = "break-word"; // Modern text wrapping
    selectedDates.style.textAlign = "center";
  }
  //developing a confirmation booking UI response after submitting form
  document.getElementById('booking-form').addEventListener('submit', async function (event) {
    event.preventDefault(); // Prevent default form submission

    // Collect the form data
    if (validateForm()) {
      const formData = {
        arrival_date: document.getElementById('arrival_date').value,
        departure_date: document.getElementById('departure_date').value,
        arrival_time: document.getElementById('arrival_time').value,
        departure_time: document.getElementById('departure_time').value,
        name: document.getElementById('name').value,
        email: document.getElementById('email').value,
        car_brand: document.getElementById('car_brand').value,
        car_color: document.getElementById('car_color').value,
        car_type: document.getElementById('car_type').value,
        license_plate: document.getElementById('license_plate').value
      };
      //COMPANY INVOICE EXTRA INFORMATION
      // Include company details if "Yes" is selected
      if (document.getElementById('select-option').value === '1') {
        formData.company_name = document.getElementById('companyName').value || null;
        formData.company_address = document.getElementById('companyAddress').value || null;
        formData.postal_code = document.getElementById('postalCode').value || null;
        formData.city = document.getElementById('city').value || null;
        formData.country = document.getElementById('country').value || null;
        formData.kvk_number = document.getElementById('kvkNumber').value || null; // Optional
        formData.vat_number = document.getElementById('vatNumber').value || null; // Optional

        // formData.contact_name = document.getElementById('contactName').value || null; // Optional
      }

      try {
        const response = await fetch("/book", {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(formData)
        });

        const result = await response.json();

        // Check if response contains bookingId
        if (result.bookingId) {
          // Hide the booking form and show confirmation
          document.querySelector(".book-h2-form").textContent = "Booking pending payment"
          document.querySelector('.book-p-form').style.display = 'none';
          document.getElementById('booking-form').style.display = 'none';
          document.getElementById('confirmation-message').style.display = 'block';


          // Show the confirmation message
          document.getElementById("confirmation-text").innerHTML = `
          <h3 class="h3-confirm">Thank you for your booking, <span class="name">${result.name}</span></h3>
          <div class="para-confirmed-div">
            <p>You have received an email with your booking details and instructions on how to proceed with the payment.</p>
            <p>You will only have your spot fully reserved once the payment is done<br>
            <p>The booking payment process will be opened for 30 min.</p>
            <p>You will recieve a confirmation email once the payment is completed.</p>
            <p>Booking REF: <span>EIN${result.bookingId}</span></p>
            <p>Total € <span>${result.totalPrice}</span></p>
             <button class="buttons" id="new-booking-btn">Make Another Booking</button>
          </div>
        `;

        } else {
          console.error('Booking failed:', result.message);
          alert(result.message);
        }
        //Scroll whgen response shows to the form where repsonse appered
        document.getElementById('form-box').scrollIntoView({ behavior: 'smooth', block: 'start' });


        document.getElementById('new-booking-btn').addEventListener('click', () => {
          window.location.href = '/';
          // After the page reloads, scroll to the form-box section


        });

      } catch (error) {
        console.error('Error submitting form:', error);
        alert('An error occurred while processing your booking.');
      } finally {
        submitButton.disabled = false; // Re-enable the button
      }
    } else {
      console.log("Form validation failed, submission prevented.");
    }

  });

  //chanckes the pending status on route /check-pending everytime user loads the page
  async function updatePage() {


    try  {
      const response = await fetch('/check-pending', { method: 'POST' });
      const result = await response.json();

      if (result.pending) {
        console.log('Pending bookings were found and cancelled:', result.cancelledBookings);
      } else {
        console.log('No pending bookings to cancel.');
      }
    } catch (error) {
      console.error('Error checking pending bookings:', error);
    }
  }


  // Add event listeners to check availability when the dates are changed
  arrivalDateInput.addEventListener('change', checkAvailability);
  departureDateInput.addEventListener('change', checkAvailability);

  // Add event listeners to revalidate on input changes
  selectElement.addEventListener('change', handleDropdownChange);
  // formInputs.forEach((input) => input.addEventListener('input', validateFormInputs))


  //SHow question mark or hide it 
  const questionMark = document.getElementById('question-mark');
  const questionDiv = document.getElementById('question-div');

  questionMark.addEventListener('mouseover', () => {
    questionDiv.style.display = 'block'; // Show the explanation text
  });

  questionMark.addEventListener('mouseleave', () => {
    questionDiv.style.display = 'none'; // Hide the explanation text when mouse leaves
  });
  // Call the validation function on page load to ensure proper state
  handleDropdownChange(); // Set the correct initial state

  //makes the scrreen gp to the top page
  const mybutton = document.getElementById("top-btn");
  window.onscroll = function () { scrollFunction() };
  function scrollFunction() {
    if (document.body.scrollTop > 600 || document.documentElement.scrollTop > 600) {
      mybutton.style.display = "block";
    } else {
      mybutton.style.display = "none";
    }
  }
  mybutton.addEventListener('click', () => {
    document.body.scrollTop = 0;
    document.documentElement.scrollTop = 0;
  })
});