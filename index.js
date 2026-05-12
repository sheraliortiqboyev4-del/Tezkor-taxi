require('dotenv').config();
const { Telegraf, Scenes, session, Markup } = require('telegraf');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const express = require('express');
const axios = require('axios');

const app = express();
const port = process.env.PORT || 3000;

// Health check endpoint
app.get('/', (req, res) => res.send('Bot is running!'));

app.listen(port, () => {
    console.log(`Keep-alive server listening on port ${port}`);
});

// Self-ping to prevent sleep (Render/Heroku/Railway)
setInterval(() => {
    const url = process.env.WEB_URL;
    if (url) {
        axios.get(url).then(() => console.log('Self-ping successful')).catch(err => console.error('Self-ping failed:', err.message));
    }
}, 10 * 60 * 1000); // Every 10 minutes

const bot = new Telegraf(process.env.BOT_TOKEN);
const ADMIN_ID = parseInt(process.env.ADMIN_ID);
const ADMIN_USERNAME = process.env.ADMIN_USERNAME.replace('@', '');

// PostgreSQL Database Setup
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

let state = {
    users: {},
    orders: [],
    settings: {
        about_channel_url: 'https://t.me/tezkor_taxi_official',
        sub_channel_url: 'https://t.me/tezkor_taxi_official',
        channel_id: '',
        force_subscribe: false
    }
};

async function initDB() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS bot_data (
                id INTEGER PRIMARY KEY,
                data JSONB
            )
        `);
        
        const res = await pool.query('SELECT data FROM bot_data WHERE id = 1');
        if (res.rows.length > 0) {
            state = res.rows[0].data;
            console.log('Database loaded from PostgreSQL');
        } else {
            // Check if local db.json exists to migrate
            const DB_PATH = path.join(__dirname, 'db.json');
            if (fs.existsSync(DB_PATH)) {
                try {
                    state = JSON.parse(fs.readFileSync(DB_PATH));
                    console.log('Migrating local db.json to PostgreSQL...');
                } catch (e) {
                    console.error('Error reading db.json during migration:', e.message);
                }
            }
            await pool.query('INSERT INTO bot_data (id, data) VALUES (1, $1)', [state]);
            console.log('Initial data saved to PostgreSQL');
        }

        // Apply migrations if needed
        let needsSave = false;
        if (!state.settings) {
            state.settings = {
                about_channel_url: 'https://t.me/tezkor_taxi_official',
                sub_channel_url: 'https://t.me/tezkor_taxi_official',
                channel_id: '',
                force_subscribe: false
            };
            needsSave = true;
        }
        if (state.settings.channel_url && !state.settings.about_channel_url) {
            state.settings.about_channel_url = state.settings.channel_url;
            state.settings.sub_channel_url = state.settings.channel_url;
            delete state.settings.channel_url;
            needsSave = true;
        }
        if (needsSave) {
            await saveData(state);
            console.log('Migrations applied and saved to PostgreSQL');
        }
    } catch (err) {
        console.error('Database init error:', err.message);
    }
}

function getData() {
    return state;
}

async function saveData(data) {
    state = data;
    try {
        await pool.query('UPDATE bot_data SET data = $1 WHERE id = 1', [state]);
    } catch (err) {
        console.error('Database save error:', err.message);
    }
}

const regions = [
    'Toshkent', 'Namangan', 'Andijon', 'Farg\'ona',
    'Sirdaryo', 'Jizzax', 'Samarqand', 'Buxoro',
    'Navoiy', 'Qashqadaryo', 'Surxondaryo', 'Xorazm',
    'Qoraqalpog\'iston'
];

// Keyboards
const driverMenu = Markup.keyboard([
    ['📋 Менинг буюртмаларим', '📊 Статистика'],
    ['📍 Йўналишларни созлаш', '🔄 Ролни ўзгартириш'],
    ['🤖 Бот ҳақида']
]).resize();

const adminMenu = Markup.keyboard([
    ['📈 Умумий статистика', '📢 Барчага хабар'],
    ['⚙️ Созламалар', '🏠 Бош саҳифа']
]).resize();

const passengerMenu = Markup.keyboard([
    ['🚕 Янги буюртма', '📋 Менинг буюртмаларим'],
    ['🔄 Ролни ўзгартириш', '🤖 Бот ҳақида'],
]).resize();

// Scenes
const registrationScene = new Scenes.WizardScene(
    'REGISTRATION_SCENE',
    async (ctx) => {
        const data = getData();
        const user = data.users[ctx.from.id];
        
        if (user && user.phone) {
            ctx.wizard.state.phone = user.phone;
            ctx.wizard.state.name = user.name || ctx.from.first_name;
            await ctx.reply('Ассалому алайкум\n\nКим сифатида рўйхатдан ўтмоқчисиз?\nҚуйидаги тугмалардан бирини танланг!', Markup.keyboard([
                ['👤 Йўловчи', '🚖 Хайдовчи']
            ]).resize());
            return ctx.wizard.selectStep(2);
        }

        ctx.reply('Ассалому алайкум. Рўйхатдан ўтиш учун телефон рақамингизни киритинг', Markup.keyboard([
            [Markup.button.contactRequest('📞 Телефон рақамни юбориш')]
        ]).resize());
        return ctx.wizard.next();
    },
    async (ctx, next) => {
        if (!ctx.message) return next();
        if (ctx.message.contact) {
            ctx.wizard.state.phone = ctx.message.contact.phone_number;
            ctx.wizard.state.name = ctx.message.from.first_name;
            await ctx.reply('Ассалому алайкум\n\nКим сифатида рўйхатдан ўтмоқчисиз?\nҚуйидаги тугмалардан бирини танланг!', Markup.keyboard([
                ['👤 Йўловчи', '🚖 Хайдовчи']
            ]).resize());
            return ctx.wizard.next();
        } else {
            const text = ctx.message.text;
            if (text === '/start' || text === '/menu' || text === '🏠 Бош саҳифа') {
                await ctx.scene.leave();
                return startBot(ctx);
            }
            await ctx.reply('Илтимос, телефон рақамингизни тугма орқали юборинг.', Markup.keyboard([
                [Markup.button.contactRequest('📞 Телефон рақамни юбориш')]
            ]).resize());
        }
    },
    async (ctx, next) => {
        if (!ctx.message || !ctx.message.text) return next();
        const text = ctx.message.text;

        // Global buttons/commands
        if (text === '/start' || text === '/menu' || text === '🏠 Бош саҳифа') {
            await ctx.scene.leave();
            const data = getData();
            const user = data.users[ctx.from.id];
            if (user && user.role === 'passenger') return ctx.scene.enter('PASSENGER_SCENE');
            if (user && user.role === 'driver' && user.verified) return ctx.reply('Хайдовчи менюси:', driverMenu);
            return ctx.scene.enter('REGISTRATION_SCENE');
        }

        const role = text;
        if (role === '👤 Йўловчи') {
            const data = getData();
            data.users[ctx.from.id] = {
                id: ctx.from.id,
                name: ctx.wizard.state.name,
                phone: ctx.wizard.state.phone,
                role: 'passenger',
                verified: true,
                directions: [],
                stats: { completed: 0 }
            };
            saveData(data);

            await ctx.reply('Сиз 👤 Йўловчи сифатида рўйхатдан ўтдингиз!', passengerMenu);
            return ctx.scene.enter('PASSENGER_SCENE');
        } else if (role === '🚖 Хайдовчи') {
            const data = getData();
            const driverName = ctx.wizard.state.name;
            const driverPhone = ctx.wizard.state.phone;
            const driverId = ctx.from.id;

            // Save basic driver info (not verified)
            data.users[driverId] = {
                id: driverId,
                name: driverName,
                phone: driverPhone,
                role: 'driver',
                verified: false,
                directions: [],
                stats: { completed: 0 }
            };
            saveData(data);

            const applicationText = `🚖 ХАЙДОВЧИЛИК АРИЗАСИ\n\n👤 Исм: ${driverName}\n📞 Тел: ${driverPhone}\n🆔 ID: ${driverId}\n\nМен Теzkор Taxi тизимида хайдовчи бўлиш учун ариза юбормоқдаман.`;
            const encodedText = encodeURIComponent(applicationText);
            const adminLink = `https://t.me/${ADMIN_USERNAME}?text=${encodedText}`;

            // Send application to admin automatically
            try {
                await bot.telegram.sendMessage(ADMIN_ID, applicationText, Markup.inlineKeyboard([
                    [
                        Markup.button.callback('✅ Тасдиқлаш', `verify_${driverId}`),
                        Markup.button.callback('❌ Рад этиш', `reject_${driverId}`)
                    ]
                ]));
            } catch (err) {
                console.error('Error sending application to admin automatically:', err.message);
            }

            await ctx.reply(
                '🚖 Хайдовчи сифатида рўйхатдан ўтиш учун қуйидаги тугмани босинг ва очилган чатда "Yuborish" тугмасини босинг.\n\nАдмин аризангизни кўриб чиққандан сўнг сизни тизимда тасдиқлайди.',
                Markup.inlineKeyboard([
                    [Markup.button.url('📩 Админга ариза юбориш', adminLink)]
                ])
            );
            
            await ctx.reply(
                '✅ Ариза юборилгандан сўнг, админ тасдиқлашини кутинг.',
                Markup.keyboard([['🔄 Ролни ўзгартириш', '🏠 Бош саҳифа']]).resize()
            );
            return ctx.scene.leave();
        } else {
            await ctx.reply('Илтимос, тугмалардан бирини танланг.', Markup.keyboard([
                ['👤 Йўловчи', '🚖 Хайдовчи']
            ]).resize());
        }
    }
);

const passengerScene = new Scenes.WizardScene(
    'PASSENGER_SCENE',
    async (ctx) => {
        await ctx.reply('Ассалому алайкум\n\nҚуйидаги тугмалардан бирини танланг!', passengerMenu);
        return ctx.wizard.next();
    },
    async (ctx, next) => {
        if (!ctx.message || !ctx.message.text) return next();
        const text = ctx.message.text;
        if (text === '🏠 Бош саҳифа') {
            if (ctx.from.id === ADMIN_ID) return ctx.reply('Админ менюси:', adminMenu);
            return ctx.scene.enter('REGISTRATION_SCENE');
        }
        if (text === '🔄 Ролни ўзгартириш') {
            return ctx.scene.enter('REGISTRATION_SCENE');
        }
        if (text === '📋 Менинг буюртмаларим') return; // Handled by bot.hears
        if (text === '🚕 Янги буюртма') {
            await ctx.reply('Йўловчимисиз ёki Почта юборасизми?', Markup.keyboard([
                ['🚕 Йўловчи', '📦 Почта'],
                ['🏠 Бош саҳифа']
            ]).resize());
            return; // Stay in this step to get the type
        }
        if (text === '🚕 Йўловчи' || text === '📦 Почта') {
            ctx.wizard.state.type = text;
            await ctx.reply('Қаердан йўлга чиқасиз?', Markup.keyboard([
                ...regions.reduce((acc, curr, i) => {
                    if (i % 2 === 0) acc.push([curr, regions[i + 1] || '']);
                    return acc;
                }, []),
                ['🏠 Бош саҳифа']
            ]).resize());
            return ctx.wizard.next();
        }
        ctx.reply('Илтимос, тугмалардан бирини танланг.', passengerMenu);
    },
    async (ctx, next) => {
        if (!ctx.message || !ctx.message.text) return next();
        const text = ctx.message.text;
        if (text === '🏠 Бош саҳифа') {
            if (ctx.from.id === ADMIN_ID) return ctx.reply('Админ менюси:', adminMenu);
            return ctx.scene.enter('REGISTRATION_SCENE');
        }
        if (regions.includes(text)) {
            ctx.wizard.state.from_region = text;
            await ctx.reply('Қаерга борасиз?', Markup.keyboard([
                ...regions.filter(r => r !== text).reduce((acc, curr, i, arr) => {
                    if (i % 2 === 0) acc.push([curr, arr[i + 1] || '']);
                    return acc;
                }, []),
                ['🏠 Бош саҳифа']
            ]).resize());
            return ctx.wizard.next();
        }
        ctx.reply('Илтимос, вилоятни танланг.', Markup.keyboard([
            ...regions.reduce((acc, curr, i) => {
                if (i % 2 === 0) acc.push([curr, regions[i + 1] || '']);
                return acc;
            }, []),
            ['🏠 Бош саҳифа']
        ]).resize());
    },
    async (ctx, next) => {
        if (!ctx.message || !ctx.message.text) return next();
        const text = ctx.message.text;
        if (text === '🏠 Бош саҳифа') {
            if (ctx.from.id === ADMIN_ID) return ctx.reply('Админ менюси:', adminMenu);
            return ctx.scene.enter('REGISTRATION_SCENE');
        }
        if (regions.includes(text)) {
            ctx.wizard.state.to_region = text;
            
            if (ctx.wizard.state.type === '📦 Почта') {
                await ctx.reply('Берган Заказингиз Тўғрими ?', Markup.keyboard([
                    ['Документ 📄', 'Каробка 📦'],
                    ['Багаж 🧳', 'Қиммат Бахо Буюм 💎'],
                    ['Бошқа...'],
                    ['🏠 Бош саҳифа']
                ]).resize());
                return ctx.wizard.next();
            } else {
                await ctx.reply(`Илтимос буюртма ҳақида бироз малумот беринг!\n\nМисол учун: Соат 09:00 да ${ctx.wizard.state.from_region}дан ${ctx.wizard.state.to_region}га чиқиб кетишим кеrak 1 киши`, Markup.keyboard([['🏠 Бош саҳифа']]).resize());
                return ctx.wizard.selectStep(5);
            }
        }
        ctx.reply('Илтимос, вилоятни танланг.', Markup.keyboard([
            ...regions.filter(r => r !== ctx.wizard.state.from_region).reduce((acc, curr, i, arr) => {
                if (i % 2 === 0) acc.push([curr, arr[i + 1] || '']);
                return acc;
            }, []),
            ['🏠 Бош саҳифа']
        ]).resize());
    },
    async (ctx, next) => {
        if (!ctx.message || !ctx.message.text) return next();
        const text = ctx.message.text;
        if (text === '🏠 Бош саҳифа') {
            if (ctx.from.id === ADMIN_ID) return ctx.reply('Админ менюси:', adminMenu);
            return ctx.scene.enter('REGISTRATION_SCENE');
        }
        
        const validPackageTypes = ['Документ 📄', 'Каробка 📦', 'Багаж 🧳', 'Қиммат Бахо Буюм 💎', 'Бошқа...'];
        if (validPackageTypes.includes(text)) {
            ctx.wizard.state.packageType = text;
            await ctx.reply(`Илтимос буюртма ҳақида бироз малумот беринг!`, Markup.keyboard([['🏠 Бош саҳифа']]).resize());
            return ctx.wizard.next();
        }
        ctx.reply('Илтимос, тугмалардан бирини танланг.');
    },
    async (ctx, next) => {
        if (!ctx.message || !ctx.message.text) return next();
        const text = ctx.message.text;
        if (text === '🏠 Бош саҳифа') {
            if (ctx.from.id === ADMIN_ID) return ctx.reply('Админ менюси:', adminMenu);
            return ctx.scene.enter('REGISTRATION_SCENE');
        }
        
        const details = text;
        const data = getData();
        const user = data.users[ctx.from.id];
        
        const order = {
            id: Date.now(),
            userId: ctx.from.id,
            userName: user.name,
            userPhone: user.phone,
            username: ctx.from.username ? `@${ctx.from.username}` : '',
            type: ctx.wizard.state.type,
            from: ctx.wizard.state.from_region,
            to: ctx.wizard.state.to_region,
            packageType: ctx.wizard.state.packageType || '',
            details: details,
            status: 'pending',
            driverMessages: []
        };

        data.orders.push(order);
        saveData(data);

        await ctx.reply('Буюртмангиз қабул қилинди! Тез орада шафёрларимиз сизга алоқага чиқишади\n\nЯна буюртма бериш учун /start тугмасини босинг', passengerMenu);

        let driverMessage = `🆕 Янги буюртма! (${order.type})\n\n👤 Йўловчи: ${order.userName}\n📞 Тел: ${order.userPhone}`;
        if (order.username) {
            driverMessage += `\n-Username: ${order.username}`;
        }
        driverMessage += `\n📍 Йўналиш: ${order.from} ➡️ ${order.to}`;
        if (order.packageType) {
            driverMessage += `\n📦 Нимa: ${order.packageType}`;
        }
        driverMessage += `\nℹ️ Маълумот: ${order.details}`;

        const drivers = Object.values(data.users).filter(u => 
            u.role === 'driver' && 
            u.verified && 
            u.directions.length > 0 && 
            (u.directions.includes(`${order.from}-${order.to}`) || 
             u.directions.includes(`${order.to}-${order.from}`))
        );

        for (const driver of drivers) {
            try {
                const msg = await bot.telegram.sendMessage(driver.id, 
                    driverMessage,
                    Markup.inlineKeyboard([
                        [Markup.button.callback('✅ Қабул қилиш', `accept_${order.id}`)],
                        [Markup.button.callback('❌ Ўтказиб юбориш', `ignore_${order.id}`)]
                    ])
                );
                order.driverMessages.push({ chatId: driver.id, messageId: msg.message_id });
            } catch (err) {
                console.error(`Could not send message to driver ${driver.id}:`, err.message);
            }
        }
        saveData(data);
        return ctx.scene.leave();
    }
);

const directionScene = new Scenes.WizardScene(
    'DIRECTION_SCENE',
    async (ctx) => {
        const data = getData();
        const user = data.users[ctx.from.id];
        let text = '📍 Сизнинг ҳозирги йўналишларингиз:\n';
        if (user.directions.length === 0) {
            text += 'Ҳеч қандай йўналиш танланмаган (Барча буюртмалар келади)';
        } else {
            user.directions.forEach(d => text += `- ${d}\n`);
        }
        text += '\nЯнги йўналиш қўшиш учун "Қаердан" вилоятини танланг:';
        
        await ctx.reply(text, Markup.keyboard([
            ...regions.reduce((acc, curr, i) => {
                if (i % 2 === 0) acc.push([curr, regions[i + 1] || '']);
                return acc;
            }, []),
            ['✅ Сақлаш'],
            ['🗑 Тозалаш', '🏠 Бош саҳифа']
        ]).resize());
        return ctx.wizard.next();
    },
    async (ctx, next) => {
        if (!ctx.message || !ctx.message.text) return next();
        const text = ctx.message.text;
        if (text === '🏠 Бош саҳифа') {
            if (ctx.from.id === ADMIN_ID) return ctx.reply('Админ менюси:', adminMenu);
            return ctx.scene.enter('REGISTRATION_SCENE');
        }
        if (text === '✅ Сақлаш') {
            await ctx.reply('Йўналишлар сақланди!', driverMenu);
            return ctx.scene.leave();
        }
        if (text === '🗑 Тозалаш') {
            const data = getData();
            data.users[ctx.from.id].directions = [];
            saveData(data);
            await ctx.reply('Йўналишлар тозаланди.');
            return ctx.scene.reenter();
        }
        if (regions.includes(text)) {
            ctx.wizard.state.from = text;
            await ctx.reply('Қаерга борадиган буюртмаларни олмоқчисиз?', Markup.keyboard([
                ...regions.filter(r => r !== text).reduce((acc, curr, i, arr) => {
                    if (i % 2 === 0) acc.push([curr, arr[i + 1] || '']);
                    return acc;
                }, []),
                ['🏠 Бош саҳифа']
            ]).resize());
            return ctx.wizard.next();
        }
    },
    async (ctx, next) => {
        if (!ctx.message || !ctx.message.text) return next();
        const text = ctx.message.text;
        if (text === '🏠 Бош саҳифа') {
            if (ctx.from.id === ADMIN_ID) return ctx.reply('Админ менюси:', adminMenu);
            return ctx.scene.enter('REGISTRATION_SCENE');
        }
        if (regions.includes(text)) {
            const dir = `${ctx.wizard.state.from}-${text}`;
            const data = getData();
            if (!data.users[ctx.from.id].directions.includes(dir)) {
                data.users[ctx.from.id].directions.push(dir);
                saveData(data);
                await ctx.reply(`✅ ${dir} йўналиши қўшилди!`);
            } else {
                await ctx.reply('Бу йўналиш аллақачон бор.');
            }
            return ctx.scene.reenter();
        }
    }
);

const broadcastScene = new Scenes.WizardScene(
    'BROADCAST_SCENE',
    async (ctx) => {
        await ctx.reply('📢 Юбормоқчи бўлган хабарингизни ёзинг (матн, расм, видео ёки бошқа турдаги хабарларни ҳам юборса бўлади):', Markup.keyboard([['🏠 Бош саҳифа']]).resize());
        return ctx.wizard.next();
    },
    async (ctx, next) => {
        if (!ctx.message) return next();
        if (ctx.message.text === '🏠 Бош саҳифа') return ctx.scene.enter('REGISTRATION_SCENE');
        
        const data = getData();
        const users = Object.values(data.users);
        let count = 0;
        
        await ctx.reply(`Хабар ${users.length} та фойдаланувчига юборилмоқда...`);
        
        for (const user of users) {
            try {
                await bot.telegram.copyMessage(user.id, ctx.chat.id, ctx.message.message_id);
                count++;
            } catch (e) {}
        }
        
        await ctx.reply(`✅ Хабар ${count} та фойдаланувчига муваффақиятли юборилди!`);
        if (ctx.from.id === ADMIN_ID) return ctx.reply('Админ менюси:', adminMenu);
        return ctx.scene.enter('REGISTRATION_SCENE');
    }
);

const supportReplyScene = new Scenes.WizardScene(
    'SUPPORT_REPLY_SCENE',
    async (ctx) => {
        await ctx.reply(`✍️ Жавоб хабарингизни ёзинг (матн, расм va ҳ.к.):`, Markup.keyboard([['🏠 Бош саҳифа']]).resize());
        return ctx.wizard.next();
    },
    async (ctx) => {
        if (!ctx.message) return;
        if (ctx.message.text === '🏠 Бош саҳифа') {
            if (ctx.from.id === ADMIN_ID) return ctx.reply('Админ менюси:', adminMenu);
            return ctx.scene.enter('REGISTRATION_SCENE');
        }
        
        const userId = ctx.wizard.state.targetUserId;
        try {
            await bot.telegram.copyMessage(userId, ctx.chat.id, ctx.message.message_id);
            await ctx.reply('✅ Жавобингиз юборилди!', adminMenu);
        } catch (e) {
            await ctx.reply('❌ Жавоб юборишда хатолик: ' + e.message, adminMenu);
        }
        return ctx.scene.leave();
    }
);

const supportScene = new Scenes.WizardScene(
    'SUPPORT_SCENE',
    async (ctx) => {
        await ctx.reply(
            '🆘 Ёрдам бўлими\n\n' +
            'Агар ботда муаммо юзага келган бўлса, бемалол муаммони батафсил ёзишингиз мумкин. Хабарингиз админга юборилади.',
            Markup.keyboard([['🏠 Бош саҳифа']]).resize()
        );
        return ctx.wizard.next();
    },
    async (ctx) => {
        if (!ctx.message) return;
        if (ctx.message.text === '🏠 Бош саҳифа') {
            if (ctx.from.id === ADMIN_ID) return ctx.reply('Админ менюси:', adminMenu);
            return ctx.scene.enter('REGISTRATION_SCENE');
        }
        
        const data = getData();
        const user = data.users[ctx.from.id] || { name: ctx.from.first_name, phone: 'Noma\'lum', role: 'passenger' };
        
        await bot.telegram.sendMessage(ADMIN_ID, 
            `📩 Янги мурожаат!\n\n👤 Кимдан: ${user.name}\n📞 Тел: ${user.phone}\n🆔 ID: ${ctx.from.id}\n\n💬 Хабар:`,
            Markup.inlineKeyboard([
                [Markup.button.callback('✍️ Жавоб қайтариш', `support_reply_${ctx.from.id}`)]
            ])
        ).catch(e => {});

        await bot.telegram.copyMessage(ADMIN_ID, ctx.from.id, ctx.message.message_id).catch(e => {});
        
        const menu = user.role === 'driver' ? driverMenu : Markup.keyboard([
            ['🚕 Янги буюртма', '📋 Менинг буюртмаларим'],
            ['🔄 Ролни ўзгартириш', '🏠 Бош саҳифа']
        ]).resize();

        await ctx.reply('✅ Хабарингиз админга юборилdi. Тез орада жавоб қайтарамиз.', menu);
        return ctx.scene.leave();
    }
);

const adminSettingsScene = new Scenes.WizardScene(
    'ADMIN_SETTINGS_SCENE',
    async (ctx) => {
        const type = ctx.wizard.state.type;
        if (type === 'about_url') {
            await ctx.reply('🤖 "Бот ҳақида" учун янги канал URL манзилини киритинг:', Markup.keyboard([['🏠 Бош саҳифа']]).resize());
        } else if (type === 'sub_url') {
            await ctx.reply('📢 Мажбурий обуна учун янги канал URL манзилини киритинг:', Markup.keyboard([['🏠 Бош саҳифа']]).resize());
        } else {
            await ctx.reply('🆔 Мажбурий обуна учун канал ID рақамини киритинг:', Markup.keyboard([['🏠 Бош саҳифа']]).resize());
        }
        return ctx.wizard.next();
    },
    async (ctx) => {
        if (!ctx.message || !ctx.message.text) return;
        if (ctx.message.text === '🏠 Бош саҳифа') return ctx.scene.enter('REGISTRATION_SCENE');
        
        const data = getData();
        const type = ctx.wizard.state.type;
        if (type === 'about_url') {
            data.settings.about_channel_url = ctx.message.text;
            await ctx.reply('✅ "Бот ҳақида" канали сақланди!');
        } else if (type === 'sub_url') {
            data.settings.sub_channel_url = ctx.message.text;
            await ctx.reply('✅ Мажбурий обуна канали сақланди!');
        } else {
            data.settings.channel_id = ctx.message.text;
            await ctx.reply('✅ Канал ID рақами сақланди!');
        }
        saveData(data);
        return ctx.scene.leave();
    }
);

const stage = new Scenes.Stage([registrationScene, passengerScene, directionScene, broadcastScene, supportReplyScene, supportScene, adminSettingsScene]);

// Global handlers for all scenes to allow breaking out
stage.start(async (ctx) => {
    await ctx.scene.leave();
    return startBot(ctx);
});

stage.command('menu', async (ctx) => {
    await ctx.scene.leave();
    return showMenu(ctx);
});

stage.hears('🏠 Бош саҳифа', async (ctx) => {
    await ctx.scene.leave();
    return showMenu(ctx);
});

stage.hears('🔄 Ролни ўзгартириш', async (ctx) => {
    await ctx.scene.leave();
    return ctx.scene.enter('REGISTRATION_SCENE');
});

bot.use(session());

async function startBot(ctx) {
    if (ctx.from.id === ADMIN_ID) {
        return ctx.reply('Хуш келибсиз, Админ!', adminMenu);
    }

    const data = getData();
    const user = data.users[ctx.from.id];
    
    if (user) {
        if (user.role === 'passenger') {
            return ctx.scene.enter('PASSENGER_SCENE');
        } else if (user.role === 'driver') {
            if (!user.verified) {
                // Re-notify admin if they press start again
                const applicationText = `🚖 ХАЙДОВЧИЛИК АРИЗАСИ (ҚАЙТА)\n\n👤 Исм: ${user.name}\n📞 Тел: ${user.phone}\n🆔 ID: ${user.id}\n\nУшбу хайдовчи тасдиқланишини кутмоқда.`;
                bot.telegram.sendMessage(ADMIN_ID, applicationText, Markup.inlineKeyboard([
                    [
                        Markup.button.callback('✅ Тасдиқлаш', `verify_${user.id}`),
                        Markup.button.callback('❌ Рад этиш', `reject_${user.id}`)
                    ]
                ])).catch(e => console.error('Error re-notifying admin:', e.message));

                return ctx.reply('Аризангиз ҳали тасдиқланмаган. Илтимос кутинг.', Markup.removeKeyboard());
            }
            if (!user.directions || user.directions.length === 0) {
                return ctx.reply(
                    `Ассалому алайкум Хайдовчи ${user.name}!\n\n⚠️ Сиз ҳали биронта йўналиш танламагансиз. Йўналиш танламасангиз сизга буюртмалар келмайди.\n\nИлтимос, "📍 Йўналишларни созлаш" тугмаси орқали йўналишларни қўшинг.`,
                    driverMenu
                );
            }
            return ctx.reply(`Ассалому алайкум Хайдовчи ${user.name}!\n\nКеракли бўлимни танланг:`, driverMenu);
        }
    }
    
    return ctx.scene.enter('REGISTRATION_SCENE');
}

async function showMenu(ctx) {
    if (ctx.from.id === ADMIN_ID) return ctx.reply('Админ менюси:', adminMenu);
    const data = getData();
    const user = data.users[ctx.from.id];
    if (user) {
        if (user.role === 'driver' && user.verified) return ctx.reply('Хайдовчи менюси:', driverMenu);
        if (user.role === 'passenger') return ctx.scene.enter('PASSENGER_SCENE');
    }
    return ctx.scene.enter('REGISTRATION_SCENE');
}

// Middleware for mandatory subscription
bot.use(async (ctx, next) => {
    if (ctx.from && ctx.from.id === ADMIN_ID) return next();
    
    const data = getData();
    const settings = data.settings;
    
    if (settings.force_subscribe && settings.channel_id) {
        try {
            const member = await ctx.telegram.getChatMember(settings.channel_id, ctx.from.id);
            const status = member.status;
            
            if (status === 'left' || status === 'kicked') {
                return ctx.reply(
                    `⚠️ Ботдан фойдаланиш учун расмий каналимизга аъзо бўлишингиз керак!`,
                    Markup.inlineKeyboard([
                        [Markup.button.url('📢 Каналга аъзо бўлиш', settings.sub_channel_url)],
                        [Markup.button.callback('✅ Текшириш', 'check_sub')]
                    ])
                );
            }
        } catch (e) {
            console.error('Subscription check error:', e.message);
            // If error (e.g. bot is not admin in channel), proceed but log it
        }
    }
    return next();
});

bot.action('check_sub', async (ctx) => {
    const data = getData();
    const settings = data.settings;
    try {
        const member = await ctx.telegram.getChatMember(settings.channel_id, ctx.from.id);
        if (member.status !== 'left' && member.status !== 'kicked') {
            await ctx.answerCbQuery('✅ Раҳмат! Энди ботдан фойдаланишингиз мумкин.');
            await ctx.deleteMessage();
            return ctx.scene.enter('REGISTRATION_SCENE');
        } else {
            await ctx.answerCbQuery('❌ Сиз ҳали аъзо бўлмадингиз!', { show_alert: true });
        }
    } catch (e) {
        await ctx.answerCbQuery('⚠️ Хатолик юз берди. Илтимос бироздан сўнг уриниб кўринг.');
    }
});

bot.use(stage.middleware());

bot.start(async (ctx) => {
    return startBot(ctx);
});

bot.command('menu', async (ctx) => {
    return showMenu(ctx);
});

bot.help((ctx) => {
    return ctx.scene.enter('SUPPORT_SCENE');
});

bot.hears('🚕 Янги буюртма', async (ctx) => {
    const data = getData();
    const user = data.users[ctx.from.id];
    if (user && user.role === 'passenger') {
        await ctx.scene.enter('PASSENGER_SCENE');
        return ctx.reply('Йўловчимисиз ёки Почта юборасизми?', Markup.keyboard([
            ['🚕 Йўловчи', '📦 Почта'],
            ['🏠 Бош саҳифа']
        ]).resize());
    } else if (user && user.role === 'driver') {
        return ctx.reply('Хайдовчилар янги буюртма бера олмайдилар. Ролингизни ўзгартиринг.', driverMenu);
    }
    return ctx.reply('Илтимос, аввал рўйхатдан ўтинг.');
});

bot.hears('📋 Менинг буюртмаларим', (ctx) => {
    const data = getData();
    const user = data.users[ctx.from.id];
    
    if (!user) return;

    if (user.role === 'driver') {
        const myOrders = data.orders.filter(o => o.driverId === ctx.from.id && o.status === 'accepted');
        if (myOrders.length === 0) return ctx.reply('Сизда ҳозирда фаол буюртмалар йўқ.');
        
        myOrders.forEach(order => {
            ctx.reply(
                `📋 Буюртма #${order.id}\n\n👤 Йўловчи: ${order.userName}\n📞 Тел: ${order.userPhone}\n📍 Йўналиш: ${order.from} - ${order.to}\nℹ️ Маълумот: ${order.details}`,
                Markup.inlineKeyboard([
                    [
                        Markup.button.callback('✅ Якунлаш', `complete_order_${order.id}`),
                        Markup.button.callback('❌ Бекор қилиш', `cancel_order_${order.id}`)
                    ]
                ])
            );
        });
    } else {
        const myOrders = data.orders.filter(o => o.userId === ctx.from.id && (o.status === 'pending' || o.status === 'accepted'));
        if (myOrders.length === 0) return ctx.reply('Сизда ҳозирда фаол буюртмалар йўқ.');

        myOrders.forEach(order => {
            const statusText = order.status === 'pending' ? '⏳ Кутилмоқда' : `✅ Қабул қилинди (Хайдовчи: ${order.driverName})`;
            ctx.reply(
                `📋 Буюртма #${order.id}\n\n📍 Йўналиш: ${order.from} - ${order.to}\nℹ️ Маълумот: ${order.details}\n📊 Ҳолат: ${statusText}`,
                Markup.inlineKeyboard([
                    [Markup.button.callback('❌ Буюртмани бекор қилиш', `passenger_cancel_${order.id}`)]
                ])
            );
        });
    }
});

bot.action(/complete_order_(.+)/, async (ctx) => {
    const orderId = parseInt(ctx.match[1]);
    const data = getData();
    const orderIndex = data.orders.findIndex(o => o.id === orderId);
    const order = data.orders[orderIndex];

    if (!order) return ctx.answerCbQuery('Буюртма топилмади.');
    if (order.driverId !== ctx.from.id) return ctx.answerCbQuery('Бу сизни буюртмангиз эmas!');

    order.status = 'completed';
    
    // Increment driver stats on completion
    const driver = data.users[ctx.from.id];
    if (driver) {
        driver.stats.completed++;
    }
    
    saveData(data);

    await ctx.answerCbQuery('Буюртма якунланди!');
    await ctx.editMessageText(ctx.callbackQuery.message.text + '\n\n✅ БУЮРТМА ЯКУНЛАНДИ');
    
    bot.telegram.sendMessage(order.userId, `✅ Сизнинг буюртмангиз #${order.id} якунланди. Тезкор Taxi хизматидан фойдаланганингиз учун раҳмат!`).catch(e => {});
});

bot.hears('🏠 Бош саҳифа', async (ctx) => {
    try { await ctx.scene.leave(); } catch (e) {}
    if (ctx.from.id === ADMIN_ID) return ctx.reply('Админ менюси:', adminMenu);
    const data = getData();
    const user = data.users[ctx.from.id];
    if (user && user.role === 'driver' && user.verified) return ctx.reply('Хайдовчи менюси:', driverMenu);
    if (user && user.role === 'passenger') return ctx.scene.enter('PASSENGER_SCENE');
    return ctx.scene.enter('REGISTRATION_SCENE');
});

bot.hears('📊 Статистика', (ctx) => {
    const data = getData();
    const user = data.users[ctx.from.id];
    if (user && user.role === 'driver') {
        ctx.reply(`📊 Сизнинг статистикангиз:\n\n✅ Қабул қилинган буюртмалар: ${user.stats.completed}`);
    }
});

bot.hears('📍 Йўналишларни созлаш', (ctx) => ctx.scene.enter('DIRECTION_SCENE'));

bot.hears('🔄 Ролни ўзгартириш', (ctx) => {
    return ctx.scene.enter('REGISTRATION_SCENE');
});

bot.action(/passenger_cancel_(.+)/, async (ctx) => {
    const orderId = parseInt(ctx.match[1]);
    const data = getData();
    const orderIndex = data.orders.findIndex(o => o.id === orderId);
    const order = data.orders[orderIndex];

    if (!order) return ctx.answerCbQuery('Буюртма топилмади.');
    if (order.userId !== ctx.from.id) return ctx.answerCbQuery('Бу сизни буюртмангиз эмас!');

    // If accepted, notify driver
    if (order.status === 'accepted' && order.driverId) {
        bot.telegram.sendMessage(order.driverId, `⚠️ Буюртма #${order.id} йўловчи томонидан бекор қилинди.`).catch(e => {});
        const driver = data.users[order.driverId];
        if (driver) driver.stats.completed = Math.max(0, driver.stats.completed - 1);
    }

    // Delete driver messages
    if (order.driverMessages) {
        for (const msg of order.driverMessages) {
            bot.telegram.deleteMessage(msg.chatId, msg.messageId).catch(e => {});
        }
    }

    data.orders.splice(orderIndex, 1);
    saveData(data);

    await ctx.answerCbQuery('Буюртмангиз бекор қилинди.');
    await ctx.editMessageText('❌ Буюртма бекор қилинди.');
});

bot.hears('🤖 Бот ҳақида', async (ctx) => {
    const data = getData();
    await ctx.reply(`🤖 Tezkor Taxi Bot\n\nBizning rasmiy kanalimizga a'zo bo'ling!`, Markup.inlineKeyboard([
        [Markup.button.url('📢 Расмий канал', data.settings.about_channel_url)]
    ]));
});

bot.hears('⚙️ Созламалар', (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const data = getData();
    const settings = data.settings;
    
    let text = `⚙️ Бот созламалари:\n\n🤖 Бот ҳақида канали: ${settings.about_channel_url}\n📢 Обуна канали: ${settings.sub_channel_url}\n🆔 Канал ID: ${settings.channel_id || 'Киритилмаган'}\n✅ Мажбурий обуна: ${settings.force_subscribe ? 'Ёқилган' : 'Ўчирилган'}`;
    
    ctx.reply(text, Markup.inlineKeyboard([
        [Markup.button.callback('🤖 "Бот ҳақида" каналини ўзгартириш', 'set_about_url')],
        [Markup.button.callback('📢 Обуна каналини ўзгартириш', 'set_sub_url')],
        [Markup.button.callback('🆔 Канал ID ўзгартириш', 'set_channel_id')],
        [Markup.button.callback(`${settings.force_subscribe ? '❌ Обунани ўчириш' : '✅ Обунани ёқиш'}`, 'toggle_force_subscribe')],
        [Markup.button.callback('🏠 Бош саҳифа', 'admin_home')]
    ]));
});

bot.action('admin_home', async (ctx) => {
    await ctx.editMessageText('Админ менюси:');
    return ctx.reply('Хуш келибсиз, Админ!', adminMenu);
});

bot.action('toggle_force_subscribe', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const data = getData();
    data.settings.force_subscribe = !data.settings.force_subscribe;
    saveData(data);
    await ctx.answerCbQuery('Мажбурий обуна ҳолати ўзгарди');
    
    const settings = data.settings;
    let text = `⚙️ Бот созламалари:\n\n🤖 Бот ҳақида канали: ${settings.about_channel_url}\n📢 Обуна канали: ${settings.sub_channel_url}\n🆔 Канал ID: ${settings.channel_id || 'Киритилмаган'}\n✅ Мажбурий обуна: ${settings.force_subscribe ? 'Ёқилган' : 'Ўчирилган'}`;
    
    await ctx.editMessageText(text, Markup.inlineKeyboard([
        [Markup.button.callback('🤖 "Бот ҳақида" каналини ўзгартириш', 'set_about_url')],
        [Markup.button.callback('📢 Обуна каналини ўзгартириш', 'set_sub_url')],
        [Markup.button.callback('🆔 Канал ID ўзгартириш', 'set_channel_id')],
        [Markup.button.callback(`${settings.force_subscribe ? '❌ Обунани ўчириш' : '✅ Обунани ёқиш'}`, 'toggle_force_subscribe')],
        [Markup.button.callback('🏠 Бош саҳифа', 'admin_home')]
    ]));
});

bot.action('set_about_url', async (ctx) => {
    await ctx.answerCbQuery();
    return ctx.scene.enter('ADMIN_SETTINGS_SCENE', { type: 'about_url' });
});

bot.action('set_sub_url', async (ctx) => {
    await ctx.answerCbQuery();
    return ctx.scene.enter('ADMIN_SETTINGS_SCENE', { type: 'sub_url' });
});

bot.action('set_channel_id', async (ctx) => {
    await ctx.answerCbQuery();
    return ctx.scene.enter('ADMIN_SETTINGS_SCENE', { type: 'id' });
});

bot.action(/cancel_order_(.+)/, async (ctx) => {
    const orderId = parseInt(ctx.match[1]);
    const data = getData();
    const order = data.orders.find(o => o.id === orderId);

    if (!order) return ctx.answerCbQuery('Буюртма топилмади.');
    if (order.driverId !== ctx.from.id) return ctx.answerCbQuery('Бу сизни буюртмангиз эмас!');

    const driver = data.users[ctx.from.id];
    if (driver) {
        driver.stats.completed = Math.max(0, driver.stats.completed - 1);
    }

    // Reset order status
    order.status = 'pending';
    order.driverId = null;
    order.driverName = null;
    order.driverPhone = null;
    order.driverMessages = []; // Clear old message references

    saveData(data);

    await ctx.answerCbQuery('Буюртма бекор қилинди!');
    await ctx.editMessageText(ctx.callbackQuery.message.text + '\n\n❌ СИЗ ТОМОНИНГИЗДАН БЕКОР ҚИЛИНДИ');

    // Notify user
    bot.telegram.sendMessage(order.userId, `⚠️ Хайдовчи буюртмангизни бекор қилди. Буюртмангиз бошқа хайдовчиларга қайта юборилди.`).catch(e => {});

    // Notify other matching drivers
    let driverMessage = `🔄 Қайта юборилган буюртма! (${order.type})\n\n👤 Йўловчи: ${order.userName}\n📞 Тел: ${order.userPhone}`;
    if (order.username) {
        driverMessage += `\n-Username: ${order.username}`;
    }
    driverMessage += `\n📍 Йўналиш: ${order.from} ➡️ ${order.to}`;
    if (order.packageType) {
        driverMessage += `\n📦 Нимa: ${order.packageType}`;
    }
    driverMessage += `\nℹ️ Маълумот: ${order.details}`;

    const drivers = Object.values(data.users).filter(u => 
        u.role === 'driver' && 
        u.verified && 
        u.id !== ctx.from.id && // Don't send back to the same driver immediately
        u.directions.length > 0 && 
        (u.directions.includes(`${order.from}-${order.to}`) || 
         u.directions.includes(`${order.to}-${order.from}`))
    );

    for (const driverObj of drivers) {
        try {
            const msg = await bot.telegram.sendMessage(driverObj.id, 
                driverMessage,
                Markup.inlineKeyboard([
                    [Markup.button.callback('✅ Қабул қилиш', `accept_${order.id}`)],
                    [Markup.button.callback('❌ Ўтказиб юбориш', `ignore_${order.id}`)]
                ])
            );
            order.driverMessages.push({ chatId: driverObj.id, messageId: msg.message_id });
        } catch (err) {
            console.error(`Could not resend message to driver ${driverObj.id}:`, err.message);
        }
    }
    saveData(data);
});

bot.hears('📈 Умумий статистика', (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const data = getData();
    const users = Object.values(data.users);
    const drivers = users.filter(u => u.role === 'driver');
    const passengers = users.filter(u => u.role === 'passenger');
    const orders = data.orders;
    
    let text = `📈 Умумий статистика:\n\n👤 Йўловчилар: ${passengers.length}\n🚖 Хайдовчилар: ${drivers.length} (Тасдиқланган: ${drivers.filter(d => d.verified).length})\n📦 Умумий буюртмаlar: ${orders.length}`;
    
    ctx.reply(text, Markup.inlineKeyboard([
        [Markup.button.callback('✅ Тасдиқланган хайдовчилар', 'manage_drivers_verified_0')],
        [Markup.button.callback('⏳ Кутаётган аризалар', 'manage_drivers_unverified_0')]
    ]));
});

bot.action(/manage_drivers_(verified|unverified)_(\d+)/, async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const type = ctx.match[1];
    const page = parseInt(ctx.match[2]);
    const data = getData();
    const allDrivers = Object.values(data.users).filter(u => u.role === 'driver');
    const drivers = type === 'verified' ? allDrivers.filter(d => d.verified) : allDrivers.filter(d => !d.verified);
    
    const pageSize = 10;
    const start = page * pageSize;
    const end = start + pageSize;
    const paginatedDrivers = drivers.slice(start, end);
    
    const typeText = type === 'verified' ? 'Тасдиқланган' : 'Кутаётган';
    let text = `🚖 ${typeText} хайдовчилар (Жами: ${drivers.length}, Саҳифа: ${page + 1}):`;
    
    const buttons = paginatedDrivers.map(d => [
        Markup.button.callback(`${d.verified ? '✅' : '❌'} ${d.name} (${d.phone})`, `manage_driver_${d.id}_${type}_${page}`)
    ]);
    
    const navButtons = [];
    if (page > 0) navButtons.push(Markup.button.callback('⬅️ Орқага', `manage_drivers_${type}_${page - 1}`));
    if (end < drivers.length) navButtons.push(Markup.button.callback('Олдинга ➡️', `manage_drivers_${type}_${page + 1}`));
    
    if (navButtons.length > 0) buttons.push(navButtons);
    buttons.push([Markup.button.callback('🏠 Бош саҳифа', 'admin_home_stats')]);

    try {
        await ctx.editMessageText(text, Markup.inlineKeyboard(buttons));
    } catch (e) {
        await ctx.reply(text, Markup.inlineKeyboard(buttons));
    }
});

bot.action('admin_home_stats', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const data = getData();
    const users = Object.values(data.users);
    const drivers = users.filter(u => u.role === 'driver');
    const passengers = users.filter(u => u.role === 'passenger');
    const orders = data.orders;
    
    let text = `📈 Умумий статистика:\n\n👤 Йўловчилар: ${passengers.length}\n🚖 Хайдовчилар: ${drivers.length} (Тасдиқланган: ${drivers.filter(d => d.verified).length})\n📦 Умумий буюртмаlar: ${orders.length}`;
    
    await ctx.editMessageText(text, Markup.inlineKeyboard([
        [Markup.button.callback('✅ Тасдиқланган хайдовчилар', 'manage_drivers_verified_0')],
        [Markup.button.callback('⏳ Кутаётган аризалар', 'manage_drivers_unverified_0')]
    ]));
});

bot.action(/manage_driver_(.+?)_(verified|unverified)_(\d+)/, async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const userId = parseInt(ctx.match[1]);
    const type = ctx.match[2];
    const page = parseInt(ctx.match[3]);
    const data = getData();
    const user = data.users[userId];
    
    if (user) {
        user.verified = !user.verified;
        saveData(data);
        await ctx.answerCbQuery(`Хайдовчи ${user.verified ? 'тасдиқланди' : 'тасдиғи олиб қўйилди'}`);
        
        // Refresh the list
        const allDrivers = Object.values(data.users).filter(u => u.role === 'driver');
        const drivers = type === 'verified' ? allDrivers.filter(d => d.verified) : allDrivers.filter(d => !d.verified);
        
        const pageSize = 10;
        const start = page * pageSize;
        const end = start + pageSize;
        const paginatedDrivers = drivers.slice(start, end);
        
        const typeText = type === 'verified' ? 'Тасдиқланган' : 'Кутаётган';
        let text = `🚖 ${typeText} хайдовчилар (Жами: ${drivers.length}, Саҳифа: ${page + 1}):`;
        
        const buttons = paginatedDrivers.map(d => [
            Markup.button.callback(`${d.verified ? '✅' : '❌'} ${d.name} (${d.phone})`, `manage_driver_${d.id}_${type}_${page}`)
        ]);
        
        const navButtons = [];
        if (page > 0) navButtons.push(Markup.button.callback('⬅️ Орқага', `manage_drivers_${type}_${page - 1}`));
        if (end < drivers.length) navButtons.push(Markup.button.callback('Олдинга ➡️', `manage_drivers_${type}_${page + 1}`));
        
        if (navButtons.length > 0) buttons.push(navButtons);
        buttons.push([Markup.button.callback('🏠 Бош саҳифа', 'admin_home_stats')]);

        await ctx.editMessageText(text, Markup.inlineKeyboard(buttons));
        
        if (!user.verified) {
            bot.telegram.sendMessage(userId, '❌ Сизнинг хайдовчилик рухсатингиз admin томонидан олиб қўйилди.', Markup.removeKeyboard()).catch(e => {});
        } else {
            bot.telegram.sendMessage(userId, '✅ Сизнинг хайдовчилик рухсатингиз қайта тикланди!', driverMenu).catch(e => {});
        }
    }
});

bot.hears('📢 Барчага хабар', (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    ctx.scene.enter('BROADCAST_SCENE');
});

bot.action(/verify_(.+)/, async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const userId = parseInt(ctx.match[1]);
    const data = getData();
    if (data.users[userId]) {
        data.users[userId].verified = true;
        saveData(data);
        await ctx.answerCbQuery('Хайдовчи тасдиқланди!');
        await ctx.editMessageText(ctx.callbackQuery.message.text + '\n\n✅ ТАСДИҚЛАНДИ');
        bot.telegram.sendMessage(userId, '✅ Сизнинг хайдовчилик аризангиз тасдиқланди! Энди буюртмаларни қабул қилишингиз мумкин.', driverMenu).catch(e => console.error(`Error sending message to ${userId}:`, e.message));
    }
});

bot.action(/reject_(.+)/, async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const userId = parseInt(ctx.match[1]);
    await ctx.answerCbQuery('Рад этилди');
    await ctx.editMessageText(ctx.callbackQuery.message.text + '\n\n❌ РАД ЭТИЛДИ');
    bot.telegram.sendMessage(userId, '❌ Сизнинг хайдовчилик аризангиз рад этилди.').catch(e => console.error(`Error sending message to ${userId}:`, e.message));
});

bot.action(/accept_(.+)/, async (ctx) => {
    const orderId = parseInt(ctx.match[1]);
    const data = getData();
    const order = data.orders.find(o => o.id === orderId);

    if (!order) return ctx.answerCbQuery('Буюртма топилмади.');
    if (order.status !== 'pending') return ctx.answerCbQuery('Бу буюртма аллақачон олинган!', { show_alert: true });

    const driver = data.users[ctx.from.id];
    if (!driver || !driver.verified) return ctx.answerCbQuery('Сиз ҳали тасдиқланмагансиз!');

    order.status = 'accepted';
    order.driverId = ctx.from.id;
    order.driverName = driver.name; // Use driver.name instead of ctx.from.first_name for consistency
    order.driverPhone = driver.phone;
    
    // driver.stats.completed++; // Don't increment here, increment in complete_order
    saveData(data);

    await ctx.answerCbQuery('Сиз буюртмани қабул қилдингиз!');

    let updatedMessage = `🆕 Янги буюртма! (${order.type})\n\n👤 Йўловчи: ${order.userName}\n📞 Тел: ${order.userPhone}`;
    if (order.username) {
        updatedMessage += `\n-Username: ${order.username}`;
    }
    updatedMessage += `\n📍 Йўналиш: ${order.from} ➡️ ${order.to}`;
    if (order.packageType) {
        updatedMessage += `\n📦 Нимa: ${order.packageType}`;
    }
    updatedMessage += `\nℹ️ Маълумот: ${order.details}\n\n⚠️ БУЮРТМА ОЛИНДИ! (Хайдовчи: ${order.driverName})`;

    for (const msgInfo of order.driverMessages) {
        try {
            await bot.telegram.editMessageText(msgInfo.chatId, msgInfo.messageId, null, updatedMessage);
        } catch (err) {}
    }

    bot.telegram.sendMessage(order.userId, `✅ Сизнинг буюртмангизни хайдовчи қабул қилди!\n\n👨‍✈️ Хайдовчи: ${order.driverName}\n📞 Тел: ${order.driverPhone}`).catch(e => console.error(`Error sending message to user ${order.userId}:`, e.message));
});

bot.action(/ignore_(.+)/, async (ctx) => {
    try { await ctx.deleteMessage(); } catch (e) {}
    ctx.answerCbQuery('Ўтказиб юборилди');
});

bot.action(/support_reply_(.+)/, async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const userId = parseInt(ctx.match[1]);
    await ctx.answerCbQuery();
    return ctx.scene.enter('SUPPORT_REPLY_SCENE', { targetUserId: userId });
});

// Error handling
bot.catch((err, ctx) => {
    console.error(`Telegraf error for ${ctx.updateType}:`, err.message);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});

initDB().then(() => {
    bot.launch().then(() => console.log('Bot started!'));
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
