# Gemini Enhancer

## About
- **Version**: 1.0
- **Last Edited**: 2025/09/30

## Description
"Gemini Enhancer" is a tool designed to **help users** learn any **skill** or understand the latest news intuitively.

## Features
- Provides explanations using diagrams, tables, and mathematical expressions.
- **Exports** the output as a PDF file or **allows copying as Markdown text**.
- Displays references **for fact-checking**.

## Requirements
### For Users
- A modern web browser (**Recommended**: the latest versions of Google Chrome, Microsoft Edge, Mozilla Firefox, or Apple Safari).
- An internet connection.
- (**Optional**) An active Google AI API Key for unlimited usage.

### For Developers
**Accounts**
- GitHub account
- Vercel account
- Google Cloud account
- Auth0 account
- Upstash account

**Environment Variables**
- `UPSTASH_URL`: The URL for the Upstash KV database, used for rate limiting logged-in users.
- `UPSTASH_TOKEN`: The authentication token to access the database.
- `AUTH0_AUDIENCE`: The identifier to protect the API within Auth0.
- `AUTH0_CLIENT_ID`: The ID for the Auth0 application.
- `AUTH0_DOMAIN`: The domain of your Auth0 tenant.
- `ADMIN_USER_ID`: Your own Auth0 user ID to bypass rate limiting.
- `ADMIN_KEY`: **(Optional)** An administrator's login key.
- `GEMINI_API_KEY`: The server-side API key for the Gemini API, **used for logged-in users**.

## Usage
1. **Login** or **input your API key**.
2. Input your request **into the text box**.

## License
This project is licensed under the MIT License. See the `LICENSE` file for details.

## Author
- **Author**: UnorganizedToolBox
- **Contact**: unorganizedtoolbox@gmail.com

## Release Notes
- **1.0**: Initial release
