CREATE ROLE marketplace WITH LOGIN PASSWORD 'marketplace_dev_pw';

CREATE DATABASE marketplace OWNER marketplace;

GRANT ALL PRIVILEGES ON DATABASE marketplace TO marketplace;
