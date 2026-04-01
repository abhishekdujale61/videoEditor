import uvicorn

if __name__ == "__main__":
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=5000,
        reload=True,
        # Allow slow/large uploads: keep connections alive for up to 10 min between
        # requests (important when a single 50 MB chunk takes a while on slow links)
        timeout_keep_alive=600,
        # Allow large HTTP request lines/headers (the body itself is always streamed)
        h11_max_incomplete_event_size=16 * 1024,
    )
