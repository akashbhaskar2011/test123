// This file contains utility functions that support the main JavaScript functionality.
// It may include helper functions for data manipulation, API calls, or other repetitive tasks used throughout the application.

function fetchData(url) {
    return fetch(url)
        .then(response => {
            if (!response.ok) {
                throw new Error('Network response was not ok');
            }
            return response.json();
        })
        .catch(error => {
            console.error('There has been a problem with your fetch operation:', error);
        });
}

function formatEmailList(emails) {
    return emails.map(email => email.trim()).filter(email => email !== '');
}

function displayError(message) {
    const errorDiv = document.createElement('div');
    errorDiv.className = 'error';
    errorDiv.textContent = message;
    document.body.appendChild(errorDiv);
}

function clearElement(element) {
    while (element.firstChild) {
        element.removeChild(element.firstChild);
    }
}

export { fetchData, formatEmailList, displayError, clearElement };