"""Production entry point with fixed redacted logging and one bounded worker."""
import logging
import os
import uvicorn


def main():
    port = int(os.environ.get('PORT', '8080'))
    if not 1024 <= port <= 65535: raise ValueError('Unsupported owner service port')
    logging.basicConfig(level=logging.INFO, format='%(message)s')
    uvicorn.run('islam_research.owner_runtime:create_owner_app', factory=True,
                host='0.0.0.0', port=port, access_log=False, proxy_headers=False,
                workers=1, limit_concurrency=32, backlog=32,
                timeout_keep_alive=5, timeout_graceful_shutdown=10,
                server_header=False, date_header=False)


if __name__ == '__main__': main()
