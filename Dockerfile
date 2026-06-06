# syntax=docker/dockerfile:1

# ---- build stage ----------------------------------------------------------
FROM rust:1-bookworm AS builder
WORKDIR /app

# Pre-compile dependencies first so they stay cached across source-only changes.
COPY Cargo.toml Cargo.lock ./
RUN mkdir src \
 && echo "" > src/lib.rs \
 && echo "fn main() {}" > src/main.rs \
 && cargo build --release \
 && rm -rf src

# Now build the real sources (deps already compiled above).
COPY . .
RUN touch src/main.rs src/lib.rs && cargo build --release

# ---- runtime stage --------------------------------------------------------
# All assets (HTML/JS/CSS/template image) are embedded in the binary, so the
# runtime image only needs the executable — nothing else to copy.
FROM debian:bookworm-slim
WORKDIR /app

# Run as a non-root user.
RUN useradd --create-home --uid 10001 app
USER app

COPY --from=builder /app/target/release/qris-parser /usr/local/bin/qris-parser

ENV BIND=0.0.0.0:8080
EXPOSE 8080

CMD ["qris-parser"]
