# Payment Platform Architecture

## Version

V1

## Description

This diagram represents the architecture for the payment system.

## Key Components

- API Gateway
- Payment Service
- Redis (Idempotency, Rate limiting)
- RabbitMQ (Async processing)

## Notes

- Uses internal wallet system (no external providers yet)

![Payment Architecture](../images/payment-architeture-diagram.drawio.svg)
