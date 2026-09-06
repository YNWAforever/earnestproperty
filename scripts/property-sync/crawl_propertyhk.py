from scraping.worker import cli

if __name__ == "__main__":
    raise SystemExit(cli("propertyhk", crawl_only=True))
