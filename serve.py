import http.server
import os
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 3000
DIR = os.path.join(os.path.dirname(__file__), 'frontend')

class SPAHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIR, **kwargs)

    def send_cors_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', '*')

    def do_GET(self):
        path = self.translate_path(self.path)
        if not os.path.exists(path) or os.path.isdir(path):
            self.path = '/index.html'
        return super().do_GET()

    def end_headers(self):
        self.send_cors_headers()
        super().end_headers()

if __name__ == '__main__':
    httpd = http.server.HTTPServer(('0.0.0.0', PORT), SPAHandler)
    print(f'Serving at http://0.0.0.0:{PORT}')
    httpd.serve_forever()
