const { Client } = require('pg'); // connect to PostgreSQL

class Database {
    constructor(config) {
        this.client = new Client(config);
        this.client.connect();
    }
    
    query(sql, args) {
        return new Promise((resolve, reject) => {
            this.client.query(sql, args, (err, rows) => {
                if (err)
                    return reject(err);
                resolve(rows);
            });
        });
    }
    close() {
        return new Promise((resolve, reject) => {
            this.client.end(err => {
                if (err)
                    return reject(err);
                resolve();
            });
        });
    }
}

module.exports = Database;