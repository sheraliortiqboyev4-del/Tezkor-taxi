const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

async function query(text, params) {
    const client = await pool.connect();
    try {
        const result = await client.query(text, params);
        return result;
    } finally {
        client.release();
    }
}

async function initDB() {
    await query(`
        CREATE TABLE IF NOT EXISTS users (
            id BIGINT PRIMARY KEY,
            name VARCHAR(255),
            phone VARCHAR(50),
            role VARCHAR(50),
            verified BOOLEAN DEFAULT FALSE,
            directions TEXT[] DEFAULT '{}',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);

    await query(`
        CREATE TABLE IF NOT EXISTS orders (
            id SERIAL PRIMARY KEY,
            user_id BIGINT,
            user_name VARCHAR(255),
            user_phone VARCHAR(50),
            from_city VARCHAR(100),
            to_city VARCHAR(100),
            details TEXT,
            status VARCHAR(50) DEFAULT 'pending',
            driver_id BIGINT,
            driver_name VARCHAR(255),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);

    await query(`
        CREATE TABLE IF NOT EXISTS settings (
            key VARCHAR(100) PRIMARY KEY,
            value TEXT
        )
    `);

    // Initialize settings if not exists
    const existingSettings = await query('SELECT key FROM settings WHERE key = $1', ['about_channel_url']);
    if (existingSettings.rows.length === 0) {
        await query('INSERT INTO settings (key, value) VALUES ($1, $2)', ['about_channel_url', 'https://t.me/tezkor_taxi_official']);
        await query('INSERT INTO settings (key, value) VALUES ($1, $2)', ['sub_channel_url', 'https://t.me/tezkor_taxi_official']);
        await query('INSERT INTO settings (key, value) VALUES ($1, $2)', ['channel_id', '']);
        await query('INSERT INTO settings (key, value) VALUES ($1, $2)', ['force_subscribe', 'false']);
        await query('INSERT INTO settings (key, value) VALUES ($1, $2)', ['order_counter', '0']);
    }

    console.log('Database initialized successfully');
}

function getNextOrderId() {
    return query('UPDATE settings SET value = value::INT + 1 WHERE key = $1 RETURNING value', ['order_counter']);
}

async function getData() {
    const usersResult = await query('SELECT * FROM users');
    const ordersResult = await query('SELECT * FROM orders');
    const settingsResult = await query('SELECT * FROM settings');

    const users = {};
    usersResult.rows.forEach(row => {
        users[row.id] = {
            id: row.id,
            name: row.name,
            phone: row.phone,
            role: row.role,
            verified: row.verified,
            directions: row.directions || []
        };
    });

    const orders = ordersResult.rows.map(row => ({
        id: row.id,
        userId: row.user_id,
        userName: row.user_name,
        userPhone: row.user_phone,
        from: row.from_city,
        to: row.to_city,
        details: row.details,
        status: row.status,
        driverId: row.driver_id,
        driverName: row.driver_name,
        createdAt: row.created_at
    }));

    const settings = {};
    settingsResult.rows.forEach(row => {
        if (row.key === 'force_subscribe') {
            settings[row.key] = row.value === 'true';
        } else {
            settings[row.key] = row.value;
        }
    });

    return { users, orders, settings };
}

async function saveData(data) {
    // Save users
    for (const [id, user] of Object.entries(data.users)) {
        await query(`
            INSERT INTO users (id, name, phone, role, verified, directions)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (id) DO UPDATE SET
                name = EXCLUDED.name,
                phone = EXCLUDED.phone,
                role = EXCLUDED.role,
                verified = EXCLUDED.verified,
                directions = EXCLUDED.directions
        `, [id, user.name, user.phone, user.role, user.verified, user.directions || []]);
    }

    // Save orders - clear and re-insert for simplicity
    await query('DELETE FROM orders');
    for (const order of data.orders) {
        await query(`
            INSERT INTO orders (id, user_id, user_name, user_phone, from_city, to_city, details, status, driver_id, driver_name)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `, [order.id, order.userId, order.userName, order.userPhone, order.from, order.to, order.details, order.status, order.driverId, order.driverName]);
    }

    // Save settings
    for (const [key, value] of Object.entries(data.settings)) {
        await query(`
            INSERT INTO settings (key, value)
            VALUES ($1, $2)
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
        `, [key, String(value)]);
    }
}

async function saveOrder(order) {
    await query(`
        INSERT INTO orders (id, user_id, user_name, user_phone, from_city, to_city, details, status, driver_id, driver_name)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `, [order.id, order.userId, order.userName, order.userPhone, order.from, order.to, order.details, order.status, order.driverId, order.driverName]);
}

async function updateOrderStatus(orderId, status, driverId = null, driverName = null) {
    if (driverId) {
        await query('UPDATE orders SET status = $1, driver_id = $2, driver_name = $3 WHERE id = $4', [status, driverId, driverName, orderId]);
    } else {
        await query('UPDATE orders SET status = $1 WHERE id = $2', [status, orderId]);
    }
}

async function deleteOrder(orderId) {
    await query('DELETE FROM orders WHERE id = $1', [orderId]);
}

async function updateUserRole(userId, role, verified = false) {
    await query(`
        INSERT INTO users (id, role, verified)
        VALUES ($1, $2, $3)
        ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, verified = EXCLUDED.verified
    `, [userId, role, verified]);
}

async function updateUserVerified(userId, verified) {
    await query('UPDATE users SET verified = $1 WHERE id = $2', [verified, userId]);
}

async function updateUserDirections(userId, directions) {
    await query('UPDATE users SET directions = $1 WHERE id = $2', [directions, userId]);
}

async function updateUserName(userId, name) {
    await query('UPDATE users SET name = $1 WHERE id = $2', [name, userId]);
}

async function updateUserPhone(userId, phone) {
    await query('UPDATE users SET phone = $1 WHERE id = $2', [phone, userId]);
}

async function getSetting(key) {
    const result = await query('SELECT value FROM settings WHERE key = $1', [key]);
    return result.rows.length > 0 ? result.rows[0].value : null;
}

async function setSetting(key, value) {
    await query(`
        INSERT INTO settings (key, value)
        VALUES ($1, $2)
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
    `, [key, String(value)]);
}

module.exports = {
    query,
    initDB,
    getNextOrderId,
    getData,
    saveData,
    saveOrder,
    updateOrderStatus,
    deleteOrder,
    updateUserRole,
    updateUserVerified,
    updateUserDirections,
    updateUserName,
    updateUserPhone,
    getSetting,
    setSetting,
    pool
};