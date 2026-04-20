# InterviewIQ

An AI-powered interview analysis platform that processes recorded interviews and delivers actionable feedback to help candidates and recruiters make better decisions.

## Features

- Upload and analyze recorded video/audio interviews
- AI-generated feedback on answers, communication, and presentation
- Detailed performance reports and scoring
- Interview history and progress tracking
- REST API for integration with other tools

## Tech Stack

| Layer    | Technology         |
|----------|--------------------|
| Frontend | React              |
| Backend  | Node.js / Express  |
| AI/ML    | (your model/API)   |
| Database | (your database)    |

## Getting Started

### Prerequisites

- Node.js >= 18
- npm or yarn

### Installation

```bash
# Clone the repository
git clone https://github.com/your-username/interviewIQ.git
cd interviewIQ
```

**Backend:**

```bash
cd server
npm install
cp .env.example .env   # fill in your environment variables
npm run dev
```

**Frontend:**

```bash
cd client
npm install
npm start
```

The app will be available at `http://localhost:3000`.

## Environment Variables

Create a `.env` file in the `server/` directory based on `.env.example`:

```env
PORT=5000
DATABASE_URL=your_database_url
AI_API_KEY=your_api_key
```

## Project Structure

```
interviewIQ/
├── client/          # React frontend
│   └── src/
├── server/          # Express backend
│   ├── routes/
│   ├── controllers/
│   └── middleware/
└── README.md
```

## API Overview

| Method | Endpoint                  | Description                  |
|--------|---------------------------|------------------------------|
| POST   | `/api/interviews/upload`  | Upload a recorded interview  |
| GET    | `/api/interviews/:id`     | Get analysis results         |
| GET    | `/api/interviews`         | List all interviews          |
| DELETE | `/api/interviews/:id`     | Delete an interview          |

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Commit your changes: `git commit -m 'Add your feature'`
4. Push to the branch: `git push origin feature/your-feature`
5. Open a Pull Request

## License

[MIT](LICENSE)
