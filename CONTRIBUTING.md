# Contributing to SnowGram

Thank you for your interest in contributing to SnowGram! This document provides guidelines and instructions for contributing.

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/YOUR_USERNAME/SnowGram.git`
3. Create a feature branch: `git checkout -b feature/your-feature-name`
4. Make your changes
5. Test your changes
6. Commit with clear messages: `git commit -m "Add feature: description"`
7. Push to your fork: `git push origin feature/your-feature-name`
8. Create a Pull Request

## Development Setup

### Prerequisites
- Docker Desktop
- Snowflake account
- Python 3.11+
- Node.js 18+
- Snowflake CLI

### Local Development

```bash
# Install backend dependencies
cd backend
pip install -r requirements.txt

# Install frontend dependencies
cd ../frontend
npm install

# Setup Snowflake backend
snow sql -c your_connection -f setup_backend.sql
```

## Code Style

### Python
- Follow PEP 8
- Use type hints
- Add docstrings to functions
- Use black for formatting

### TypeScript/React
- Follow ESLint rules
- Use functional components
- Add JSDoc comments
- Use Prettier for formatting

### SQL
- Uppercase keywords
- Descriptive table/column names
- Add comments for complex queries

## Testing

```bash
# Backend tests
pytest

# Frontend tests
npm test

# Docker build test
docker build --platform linux/amd64 -f docker/Dockerfile .
```

## Pull Request Guidelines

- Provide a clear description of the changes
- Reference any related issues
- Include screenshots for UI changes
- Ensure all tests pass
- Update documentation as needed
- Keep PRs focused and atomic

## Code Review Process

1. PR is submitted
2. Automated tests run
3. Code review by maintainers
4. Address feedback
5. Approval and merge

## Reporting Issues

- Use the issue templates
- Provide detailed reproduction steps
- Include environment information
- Add screenshots if applicable

## Feature Requests

- Describe the problem you're solving
- Propose your solution
- Consider alternatives
- Discuss implementation approach

## Questions?

Feel free to open an issue for questions or reach out to the maintainers.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

