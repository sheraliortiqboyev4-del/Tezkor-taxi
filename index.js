require('dotenv').config();
const { Telegraf, Scenes, session, Markup } = require('telegraf');
const fs = require('fs');
const path = require('path');
const db = require('./db');

const bot = new Telegraf(process.env.BOT_TOKEN);
const ADMIN_ID = parseInt(process.env.ADMIN_ID);
const ADMIN_USERNAME = process.env.ADMIN_USERNAME.replace('@', '');

// Database initialization
async function initDatabase() {
    await db.initDB();
    console.log('PostgreSQL database connected successfully');
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
    ['🤖 Бот ҳақида', '🏠 Бош саҳифа']
]).resize();

const passengerMenu = Markup.keyboard([
    ['🚕 Янги буюртма', '📋 Менинг буюртмаларим'],
    ['🔄 Ролни ўзгартириш', '🤖 Бот ҳақида'],
    ['🏠 Бош саҳифа']
]).resize();

// Scenes
const registrationScene = new Scenes.WizardScene(
    'REGISTRATION_SCENE',
    async (ctx) => {
        await ctx.reply('Исммингизни киритинг:', Markup.keyboard([['🏠 Бош саҳифа']]).resize());
        return ctx.wizard.next();
    },
    async (ctx) => {
        if (!ctx.message || !ctx.message.text) return;
        if (ctx.message.text === '🏠 Бош саҳифа') return ctx.scene.enter('REGISTRATION_SCENE');
        
        ctx.wizard.state.name = ctx.message.text;
        await ctx.reply('Телефон рақамингизни киритинг:', Markup.keyboard([
            [Markup.button.contactRequest('📞 Телефон рақамни юбориш')],
            ['🏠 Бош саҳифа']
        ]).resize());
        return ctx.wizard.next();
    },
    async (ctx) => {
        if (!ctx.message) return;
        
        let phone;
        if (ctx.message.contact) {
            phone = ctx.message.contact.phone_number;
        } else if (ctx.message.text === '🏠 Бош саҳифа') {
            return ctx.scene.enter('REGISTRATION_SCENE');
        } else {
            phone = ctx.message.text;
        }
        
        ctx.wizard.state.phone = phone;
        await ctx.reply('Сиз қандай сифататда рўйхатдан ўтмоқчисиз?', Markup.keyboard([
            ['👤 Йўловчи'],
            ['🚖 Хайдовчи'],
            ['🏠 Бош саҳифа']
        ]).resize());
        return ctx.wizard.next();
    },
    async (ctx) => {
        if (!ctx.message || !ctx.message.text) return;
        const choice = ctx.message.text;
        
        if (choice === '🏠 Бош саҳифа') return ctx.scene.enter('REGISTRATION_SCENE');
        
        const data = await db.getData();
        const role = choice === '👤 Йўловчи' ? 'passenger' : 'driver';
        const userId = ctx.from.id;
        
        await db.updateUserRole(userId, role, false);
        await db.updateUserName(userId, ctx.wizard.state.name);
        await db.updateUserPhone(userId, ctx.wizard.state.phone);
        
        if (role === 'passenger') {
            await ctx.reply('Сиз 👤 Йўловчи сифатида рўйхатдан ўтдингиз!', passengerMenu);
            return ctx.scene.enter('PASSENGER_SCENE');
        } else {
            await ctx.reply('Сиз 🚖 Хайдовчи сифатида рўйхатдан ўтдингиз!\nАдмин тасдиқлашини кутинг.', Markup.removeKeyboard());
            
            const applicationText = `🚖 ХАЙДОВЧИЛИК АРИЗАСИ\n\n👤 Исм: ${ctx.wizard.state.name}\n📞 Тел: ${ctx.wizard.state.phone}\n🆔 ID: ${userId}\n\nМен Теzkор Taxi тизимида хайдовчи бўлиш учун ариза юбормоқдаман.`;
            
            try {
                await bot.telegram.sendMessage(ADMIN_ID, applicationText, Markup.inlineKeyboard([
                    [
                        Markup.button.callback('✅ Тасдиқлаш', `verify_${userId}`),
                        Markup.button.callback('❌ Рад этиш', `reject_${userId}`)
                    ]
                ]));
            } catch (err) {
                console.error('Error sending application to admin:', err.message);
            }
            
            return ctx.scene.leave();
        }
    }
);

const passengerScene = new Scenes.WizardScene(
    'PASSENGER_SCENE',
    async (ctx) => {
        await ctx.reply('Ассалому алайкум\n\nҚуйидаги тугмалардан бирини танланг!', passengerMenu);
        return ctx.wizard.next();
    },
    async (ctx) => {
        if (ctx.message && ctx.message.text === '🚕 Янги буюртма') {
            await ctx.reply('Сиз қайси тумандан?', Markup.keyboard(regions.map(r => [r]).concat([['🏠 Бош саҳифа']])).resize());
            return ctx.wizard.next();
        }
        return ctx.wizard.next();
    }
);

const directionScene = new Scenes.WizardScene(
    'DIRECTION_SCENE',
    async (ctx) => {
        await ctx.reply('Қайси йўналишларни қўшишингиз мумкин?', Markup.keyboard([
            ['Toshkent-Namangan', 'Toshkent-Andijon', 'Toshkent-Farg\'ona'],
            ['Toshkent-Sirdaryo', 'Toshkent-Jizzax', 'Toshkent-Samarqand'],
            ['Toshkent-Buxoro', 'Toshkent-Navoiy', 'Toshkent-Qashqadaryo'],
            ['Toshkent-Surxondaryo', 'Toshkent-Xorazm', 'Toshkent-Qoraqalpog\'iston'],
            ['Бошқа йўналиш қўшиш'],
            ['🏠 Бош саҳифа']
        ]).resize());
        return ctx.wizard.next();
    },
    async (ctx) => {
        if (!ctx.message || !ctx.message.text) return;
        const text = ctx.message.text;
        
        if (text === '🏠 Бош саҳифа') return ctx.scene.enter('REGISTRATION_SCENE');
        if (text === 'Бошқа йўналиш қўшиш') {
            await ctx.reply('Йўналишни киритинг (масалан: Namangan-Toshkent):');
            return ctx.wizard.next();
        }
        
        const data = await db.getData();
        const user = data.users[ctx.from.id];
        if (user) {
            const directions = user.directions || [];
            if (!directions.includes(text)) {
                directions.push(text);
                await db.updateUserDirections(ctx.from.id, directions);
            }
        }
        
        await ctx.reply('Йўналишлар рўйхати:', Markup.keyboard([
            ...(data.users[ctx.from.id]?.directions || []).map(d => [d]),
            ['Бошқа йўналиш қўшиш'],
            ['🏠 Бош саҳифа']
        ]).resize());
        return ctx.wizard.next();
    },
    async (ctx) => {
        if (!ctx.message || !ctx.message.text) return;
        const text = ctx.message.text;
        
        if (text === '🏠 Бош саҳифа') return ctx.scene.enter('REGISTRATION_SCENE');
        
        const data = await db.getData();
        const user = data.users[ctx.from.id];
        if (user) {
            const directions = user.directions || [];
            if (!directions.includes(text)) {
                directions.push(text);
                await db.updateUserDirections(ctx.from.id, directions);
            }
        }
        
        await ctx.reply('Йўналишлар рўйхати:', Markup.keyboard([
            ...(data.users[ctx.from.id]?.directions || []).map(d => [d]),
            ['Бошқа йўналиш қўшиш'],
            ['🏠 Бош саҳифа']
        ]).resize());
        return ctx.wizard.next();
    }
);

const broadcastScene = new Scenes.WizardScene(
    'BROADCAST_SCENE',
    async (ctx) => {
        await ctx.reply('Хабар матнини киритинг:', Markup.keyboard([['🏠 Бош саҳифа']]).resize());
        return ctx.wizard.next();
    },
    async (ctx) => {
        if (!ctx.message || !ctx.message.text) return;
        if (ctx.message.text === '🏠 Бош саҳифа') return ctx.scene.enter('REGISTRATION_SCENE');
        
        ctx.wizard.state.message = ctx.message.text;
        await ctx.reply('Ушбу хабарни барча фойдаланувчиларга юборишни тасдиқлайсизми?', Markup.inlineKeyboard([
            [Markup.button.callback('✅ Ха, юбориш', 'confirm_broadcast')],
            [Markup.button.callback('❌ Йўқ, бекор қилиш', 'cancel_broadcast')]
        ]));
        return ctx.wizard.next();
    },
    async (ctx) => {
        return ctx.scene.leave();
    }
);

const supportScene = new Scenes.WizardScene(
    'SUPPORT_SCENE',
    async (ctx) => {
        await ctx.reply('Мурожаатингизни матнини киритинг:', Markup.keyboard([['🏠 Бош саҳифа']]).resize());
        return ctx.wizard.next();
    },
    async (ctx) => {
        if (!ctx.message || !ctx.message.text) return;
        if (ctx.message.text === '🏠 Бош саҳифа') return ctx.scene.enter('REGISTRATION_SCENE');
        
        const data = await db.getData();
        const user = data.users[ctx.from.id];
        
        const supportText = `📩 МУРОЖААТ\n\n👤 Исм: ${user?.name || 'Номаълум'}\n📞 Тел: ${user?.phone || 'Номаълум'}\n🆔 ID: ${ctx.from.id}\n\n📝 Матн:\n${ctx.message.text}`;
        
        await bot.telegram.sendMessage(ADMIN_ID, supportText, Markup.inlineKeyboard([
            [Markup.button.callback('Жавоб бериш', `support_reply_${ctx.from.id}`)]
        ]));
        
        await ctx.reply('Мурожаатингиз қабул қилинди! Тезида жавоб olasiz.', passengerMenu);
        return ctx.scene.leave();
    }
);

const supportReplyScene = new Scenes.WizardScene(
    'SUPPORT_REPLY_SCENE',
    async (ctx) => {
        ctx.wizard.state.userId = ctx.wizard.state.userId || ctx.scene.session.userId;
        await ctx.reply('Жавоб матнини киритинг:', Markup.keyboard([['🏠 Бош саҳифа']]).resize());
        return ctx.wizard.next();
    },
    async (ctx) => {
        if (!ctx.message || !ctx.message.text) return;
        if (ctx.message.text === '🏠 Бош саҳифа') return ctx.scene.enter('REGISTRATION_SCENE');
        
        const userId = ctx.wizard.state.userId;
        await bot.telegram.sendMessage(userId, `📩 Админдан жавоб:\n\n${ctx.message.text}`).catch(e => {});
        
        await ctx.reply('Жавоб юборилди!', adminMenu);
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
        
        const data = await db.getData();
        const type = ctx.wizard.state.type;
        if (type === 'about_url') {
            await db.setSetting('about_channel_url', ctx.message.text);
            await ctx.reply('✅ "Бот ҳақида" канали сақланди!');
        } else if (type === 'sub_url') {
            await db.setSetting('sub_channel_url', ctx.message.text);
            await ctx.reply('✅ Мажбурий обуна канали сақланди!');
        } else {
            await db.setSetting('channel_id', ctx.message.text);
            await ctx.reply('✅ Канал ID рақами сақланди!');
        }
        return ctx.scene.leave();
    }
);

const stage = new Scenes.Stage([registrationScene, passengerScene, directionScene, broadcastScene, supportReplyScene, supportScene, adminSettingsScene]);
bot.use(session());

// Middleware for mandatory subscription
bot.use(async (ctx, next) => {
    if (ctx.from && ctx.from.id === ADMIN_ID) return next();
    
    const settings = await db.getSetting('force_subscribe');
    const channelId = await db.getSetting('channel_id');
    
    if (settings === 'true' && channelId) {
        try {
            const member = await ctx.telegram.getChatMember(channelId, ctx.from.id);
            const status = member.status;
            
            if (status === 'left' || status === 'kicked') {
                const subChannelUrl = await db.getSetting('sub_channel_url') || 'https://t.me/tezkor_taxi_official';
                return ctx.reply(
                    `⚠️ Ботдан фойдаланиш учун расмий каналимизга аъзо бўлишингиз керак!`,
                    Markup.inlineKeyboard([
                        [Markup.button.url('📢 Каналга аъзо бўлиш', subChannelUrl)],
                        [Markup.button.callback('✅ Текшириш', 'check_sub')]
                    ])
                );
            }
        } catch (e) {
            console.error('Subscription check error:', e.message);
        }
    }
    return next();
});

bot.action('check_sub', async (ctx) => {
    const channelId = await db.getSetting('channel_id');
    try {
        const member = await ctx.telegram.getChatMember(channelId, ctx.from.id);
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

// Bot handlers
bot.start(async (ctx) => {
    const data = await db.getData();
    const user = data.users[ctx.from.id];
    
    if (!user) {
        return ctx.scene.enter('REGISTRATION_SCENE');
    }
    
    if (user.role === 'passenger') {
        return ctx.scene.enter('PASSENGER_SCENE');
    } else if (user.role === 'driver') {
        if (!user.verified) {
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
    } else if (user.role === 'admin') {
        return ctx.reply('Админ менюси:', adminMenu);
    }
    
    return ctx.scene.enter('REGISTRATION_SCENE');
});

bot.hears('🏠 Бош саҳифа', async (ctx) => {
    const data = await db.getData();
    const user = data.users[ctx.from.id];
    
    if (!user) {
        return ctx.scene.enter('REGISTRATION_SCENE');
    }
    
    if (user.role === 'passenger') {
        return ctx.reply('Ассалому алайкум\n\nҚуйидаги тугмалардан бирини танланг!', passengerMenu);
    } else if (user.role === 'driver') {
        if (!user.verified) {
            return ctx.reply('Аризангиз ҳали тасдиқланмаган. Илтимос кутинг.', Markup.removeKeyboard());
        }
        return ctx.reply(`Ассалому алайкум Хайдовчи ${user.name}!\n\nКеракли бўлимни танланг:`, driverMenu);
    }
    
    return ctx.scene.enter('REGISTRATION_SCENE');
});

bot.hears('🔄 Ролни ўзгартириш', async (ctx) => {
    const data = await db.getData();
    delete data.users[ctx.from.id];
    await db.updateUserRole(ctx.from.id, 'passenger', false);
    return ctx.scene.enter('REGISTRATION_SCENE');
});

bot.hears('🚕 Янги буюртма', async (ctx) => {
    const data = await db.getData();
    const user = data.users[ctx.from.id];
    if (user && user.role === 'passenger') {
        await ctx.scene.enter('PASSENGER_SCENE');
        return ctx.reply('Йўловчимисиз ёки Почта юборасизми?', Markup.keyboard([
            ['🚕 Йўловчиман', '📦 Почта бор'],
            ['🏠 Бош саҳифа']
        ]).resize());
    }
    return ctx.reply('Илтимос, аввал рўйхатдан ўтинг.');
});

bot.hears('📋 Менинг буюртмаларим', (ctx) => {
    db.getData().then(data => {
        const user = data.users[ctx.from.id];
        
        if (!user) return;

        if (user.role === 'driver') {
            const myOrders = data.orders.filter(o => o.driverId === ctx.from.id && o.status === 'accepted');
            if (myOrders.length === 0) return ctx.reply('Сизда ҳозирда фаол буюртмалар йўқ.');
            
            myOrders.forEach(order => {
                ctx.reply(
                    `📋 Буюртма #${order.id}\n\n👤 Йўловчи: ${order.userName}\n📞 Тел: ${order.userPhone}\n📍 Йўналиш: ${order.from} - ${order.to}\nℹ️ Маълумот: ${order.details}`,
                    Markup.inlineKeyboard([
                        [Markup.button.callback('✅ Якунлаш', `complete_order_${order.id}`)]
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
});

bot.hears('📊 Статистика', async (ctx) => {
    const data = await db.getData();
    const user = data.users[ctx.from.id];
    
    if (user.role !== 'driver') return;
    
    const myOrders = data.orders.filter(o => o.driverId === ctx.from.id);
    const completedOrders = myOrders.filter(o => o.status === 'completed').length;
    const totalOrders = myOrders.length;
    const earnings = completedOrders * 50000;
    
    await ctx.reply(`📊 Сизнинг статистикингиз:\n\n📦 Умумий буюртмалар: ${totalOrders}\n✅ Якунланган: ${completedOrders}\n💰 Умумий даромад: ${earnings.toLocaleString()} сум`);
});

bot.hears('📍 Йўналишларни созлаш', (ctx) => {
    ctx.scene.enter('DIRECTION_SCENE');
});

bot.hears('🤖 Бот ҳақида', async (ctx) => {
    const aboutUrl = await db.getSetting('about_channel_url') || 'https://t.me/tezkor_taxi_official';
    await ctx.reply(`🤖 Tezkor Taxi Bot\n\nБизнинг расмий каналимизга а'зо бўлинг!`, Markup.inlineKeyboard([
        [Markup.button.url('📢 Расмий канал', aboutUrl)]
    ]));
});

bot.hears('⚙️ Созламалар', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const aboutUrl = await db.getSetting('about_channel_url');
    const subUrl = await db.getSetting('sub_channel_url');
    const channelId = await db.getSetting('channel_id');
    const forceSub = await db.getSetting('force_subscribe');
    
    let text = `⚙️ Бот созламалари:\n\n🤖 Бот ҳақида канали: ${aboutUrl}\n📢 Обуна канали: ${subUrl}\n🆔 Канал ID: ${channelId || 'Киритилмаган'}\n✅ Мажбурий обуна: ${forceSub === 'true' ? 'Ёқилган' : 'Ўчирилган'}`;
    
    ctx.reply(text, Markup.inlineKeyboard([
        [Markup.button.callback('🤖 "Бот ҳақида" каналини ўзгартириш', 'set_about_url')],
        [Markup.button.callback('📢 Обуна каналини ўзгартириш', 'set_sub_url')],
        [Markup.button.callback('🆔 Канал ID ўзгартириш', 'set_channel_id')],
        [Markup.button.callback(`${forceSub === 'true' ? '❌ Обунани ўчириш' : '✅ Обунани ёқиш'}`, 'toggle_force_subscribe')],
        [Markup.button.callback('🏠 Бош саҳифа', 'admin_home')]
    ]));
});

const adminMenu = Markup.keyboard([
    ['📈 Умумий статистика', '📢 Барчага хабар'],
    ['⚙️ Созламалар', '🏠 Бош саҳифа']
]).resize();

bot.hears('📈 Умумий статистика', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const data = await db.getData();
    const users = Object.values(data.users);
    const drivers = users.filter(u => u.role === 'driver');
    const passengers = users.filter(u => u.role === 'passenger');
    const orders = data.orders;
    
    let text = `📈 Умумий статистика:\n\n👤 Йўловчилар: ${passengers.length}\n🚖 Хайдовчилар: ${drivers.length} (Тасдиқланган: ${drivers.filter(d => d.verified).length})\n📦 Умумий буюртмалар: ${orders.length}`;
    
    ctx.reply(text, Markup.inlineKeyboard([
        [Markup.button.callback('✅ Тасдиқланган хайдовчилар', 'manage_drivers_verified_0')],
        [Markup.button.callback('⏳ Кутаётган аризалар', 'manage_drivers_unverified_0')]
    ]));
});

bot.action(/manage_drivers_(verified|unverified)_(\d+)/, async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const type = ctx.match[1];
    const page = parseInt(ctx.match[2]);
    const data = await db.getData();
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
    const data = await db.getData();
    const users = Object.values(data.users);
    const drivers = users.filter(u => u.role === 'driver');
    const passengers = users.filter(u => u.role === 'passenger');
    const orders = data.orders;
    
    let text = `📈 Умумий статистика:\n\n👤 Йўловчилар: ${passengers.length}\n🚖 Хайдовчилар: ${drivers.length} (Тасдиқланган: ${drivers.filter(d => d.verified).length})\n📦 Умумий буюртмалар: ${orders.length}`;
    
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
    const data = await db.getData();
    const user = data.users[userId];
    
    if (user) {
        user.verified = !user.verified;
        await db.updateUserVerified(userId, user.verified);
        await ctx.answerCbQuery(`Хайдовчи ${user.verified ? 'тасдиқланди' : 'тасдиғи олиб қўйилди'}`);
        
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
    await db.updateUserVerified(userId, true);
    
    await ctx.answerCbQuery('Хайдовчи тасдиқланди!');
    await ctx.editMessageText(ctx.callbackQuery.message.text + '\n\n✅ ТАСДИҚЛАНДИ');
    
    await bot.telegram.sendMessage(userId, '✅ Табриклайман! Сизнинг аризангиз тасдиқланди. Энди хайдовчи сифатида ишлашингиз мумкин.', driverMenu).catch(e => {});
});

bot.action(/reject_(.+)/, async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const userId = parseInt(ctx.match[1]);
    
    await ctx.answerCbQuery('Хайдовчи рад этилди!');
    await ctx.editMessageText(ctx.callbackQuery.message.text + '\n\n❌ РАД ЭТИЛДИ');
    
    await bot.telegram.sendMessage(userId, '❌ Ушбу хабар orqali sizning arizangiz rad etildi. Qo\'shimcha ma\'lumot olish uchun adminga murojaat qiling.').catch(e => {});
});

bot.action('confirm_broadcast', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    
    const message = ctx.wizard.state?.message || 'Хабар';
    const data = await db.getData();
    
    let successCount = 0;
    let failCount = 0;
    
    for (const userId of Object.keys(data.users)) {
        try {
            await bot.telegram.sendMessage(parseInt(userId), `📢 Эълон:\n\n${message}`);
            successCount++;
        } catch (e) {
            failCount++;
        }
    }
    
    await ctx.reply(`✅ Хабар ${successCount} та фойдаланувчига юборилди.\n❌ ${failCount} та хатolik.`, adminMenu);
    return ctx.scene.leave();
});

bot.action('cancel_broadcast', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    await ctx.reply('Хабар юбориш бекор қилинди.', adminMenu);
    return ctx.scene.leave();
});

bot.action(/support_reply_(.+)/, async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const userId = parseInt(ctx.match[1]);
    ctx.scene.state.userId = userId;
    return ctx.scene.enter('SUPPORT_REPLY_SCENE');
});

bot.action(/complete_order_(.+)/, async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const orderId = parseInt(ctx.match[1]);
    const data = await db.getData();
    const order = data.orders.find(o => o.id === orderId);
    
    if (order) {
        order.status = 'completed';
        await db.updateOrderStatus(orderId, 'completed');
        
        await ctx.answerCbQuery('Буюртма якунланди!');
        await ctx.editMessageText(ctx.callbackQuery.message.text + '\n\n✅ БУЮРТМА ЯКУНЛАНДИ');
        
        await bot.telegram.sendMessage(order.userId, `✅ Сизнинг буюртмангиз #${order.id} якунланди. Тезкор Taxi хизматидан фойдаланганингиз учун раҳмат!`, passengerMenu).catch(e => {});
    }
});

bot.action(/cancel_order_(.+)/, async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return;
    const orderId = parseInt(ctx.match[1]);
    const data = await db.getData();
    const orderIndex = data.orders.findIndex(o => o.id === orderId);
    
    if (orderIndex !== -1) {
        const order = data.orders[orderIndex];
        data.orders.splice(orderIndex, 1);
        await db.deleteOrder(orderId);

        await ctx.answerCbQuery('Буюртмангиз бекор қилинди.');
        await ctx.editMessageText('❌ Буюртма бекор қилинди.');
    }
});

bot.action(/passenger_cancel_(.+)/, async (ctx) => {
    const orderId = parseInt(ctx.match[1]);
    const data = await db.getData();
    const orderIndex = data.orders.findIndex(o => o.id === orderId && o.userId === ctx.from.id);
    
    if (orderIndex !== -1) {
        const order = data.orders[orderIndex];
        order.status = 'cancelled';
        await db.updateOrderStatus(orderId, 'cancelled');
        
        await ctx.answerCbQuery('Буюртма бекор қилинди!');
        await ctx.editMessageText(ctx.callbackQuery.message.text + '\n\n❌ СИЗ ТОМОНИНГИЗДАН БЕКОР ҚИЛИНДИ');

        if (order.driverId) {
            await bot.telegram.sendMessage(order.driverId, `❌ Йўловчи буюртма #${order.id} ни бекор қилди.`).catch(e => {});
        }
    }
});

bot.hears('📥 Алоқа', (ctx) => {
    ctx.scene.enter('SUPPORT_SCENE');
});

bot.hears('🚕 Янги буюртма', async (ctx) => {
    const data = await db.getData();
    const user = data.users[ctx.from.id];
    if (user && user.role === 'passenger') {
        await ctx.scene.enter('PASSENGER_SCENE');
        return ctx.reply('Сиз қайси тумандан?', Markup.keyboard(regions.map(r => [r]).concat([['🏠 Бош саҳифа']])).resize());
    }
    return ctx.reply('Илтимос, аввал рўйхатдан ўтинг.');
});

// Passenger order creation
bot.on('message', async (ctx) => {
    if (!ctx.message || !ctx.message.text) return;
    const text = ctx.message.text;
    
    if (regions.includes(text)) {
        ctx.scene.state.fromCity = text;
        await ctx.reply('Қайси манзилга?', Markup.keyboard(regions.filter(r => r !== text).map(r => [r]).concat([['🏠 Бош саҳифа']])).resize());
        return ctx.wizard.next();
    }
    
    if (ctx.scene.state.fromCity && regions.includes(text)) {
        ctx.scene.state.toCity = text;
        await ctx.reply('Қўшимча маълумот (исталса):', Markup.keyboard([['Йўқ', '🏠 Бош саҳифа']]).resize());
        return ctx.wizard.next();
    }
    
    if (ctx.scene.state.toCity && ctx.message.text !== 'Йўқ') {
        ctx.scene.state.details = ctx.message.text;
        await placeOrder(ctx);
        return;
    }
    
    if (ctx.message.text === 'Йўқ') {
        ctx.scene.state.details = '';
        await placeOrder(ctx);
        return;
    }
});

async function placeOrder(ctx) {
    const data = await db.getData();
    const user = data.users[ctx.from.id];
    const orderCounter = await db.getNextOrderId();
    const orderId = parseInt(orderCounter.rows[0].value);
    
    const order = {
        id: orderId,
        userId: ctx.from.id,
        userName: user?.name || 'Номаълум',
        userPhone: user?.phone || 'Номаълум',
        from: ctx.scene.state.fromCity,
        to: ctx.scene.state.toCity,
        details: ctx.scene.state.details || '',
        status: 'pending',
        driverId: null,
        driverName: null
    };
    
    data.orders.push(order);
    await db.saveOrder(order);
    
    const drivers = Object.values(data.users).filter(u => 
        u.role === 'driver' && 
        u.verified && 
        u.directions.length > 0 && 
        (u.directions.includes(`${order.from}-${order.to}`) || 
         u.directions.includes(`${order.to}-${order.from}`))
    );
    
    if (drivers.length > 0) {
        const driverMsg = `🚖 Янги буюртма!\n\n📍 ${order.from} - ${order.to}\n👤 ${order.userName}\n📞 ${order.userPhone}\nℹ️ ${order.details || 'Йўқ'}\n\n#${orderId}`;
        
        for (const driver of drivers) {
            await bot.telegram.sendMessage(driver.id, driverMsg, Markup.inlineKeyboard([
                [Markup.button.callback('✅ Қабул қилиш', `accept_order_${orderId}_${driver.id}`)]
            ])).catch(e => console.error('Error sending to driver:', e.message));
        }
    }
    
    await ctx.reply(`✅ Буюртмангиз қабул қилинди!\n\n📋 Буюртма рақами: #${orderId}\n📍 ${order.from} - ${order.to}\n\nЭнди кутинг, тез орада хайдовчиларимиз алоқага чиқишади.`, passengerMenu);
    
    ctx.scene.state = {};
    return ctx.scene.leave();
}

bot.action(/accept_order_(.+)_(\d+)/, async (ctx) => {
    const orderId = parseInt(ctx.match[1]);
    const driverId = parseInt(ctx.match[2]);
    const data = await db.getData();
    const order = data.orders.find(o => o.id === orderId && o.status === 'pending');
    
    if (order) {
        const driver = data.users[driverId];
        order.status = 'accepted';
        order.driverId = driverId;
        order.driverName = driver?.name || 'Номаълум';
        
        await db.updateOrderStatus(orderId, 'accepted', driverId, driver?.name);
        
        await ctx.answerCbQuery('Буюртма қабул қилинди!');
        await ctx.editMessageText(ctx.callbackQuery.message.text + '\n\n✅ ҚАБУЛ ҚИЛИНДИ');
        
        await bot.telegram.sendMessage(order.userId, `✅ Сизнинг буюртмангиз #${orderId} қабул қилинди!\n\n🚖 Хайдовчи: ${driver?.name}\n📞 Тел: ${driver?.phone}\n\nТези орада алоқага чиқишади.`).catch(e => {});
        
        // Notify other matching drivers
        const drivers = Object.values(data.users).filter(u => 
            u.role === 'driver' && 
            u.verified && 
            u.id !== ctx.from.id &&
            u.directions.length > 0 && 
            (u.directions.includes(`${order.from}-${order.to}`) || 
             u.directions.includes(`${order.to}-${order.from}`))
        );
        
        for (const d of drivers) {
            await bot.telegram.sendMessage(d.id, `❌ Буюртма #${orderId} бошқа хайдовчи томонидан қабул қилинди.`).catch(e => {});
        }
    }
});

// Initialize and start the bot
async function main() {
    try {
        await initDatabase();
        await bot.launch();
        console.log('Bot started successfully!');
    } catch (error) {
        console.error('Failed to start bot:', error);
        process.exit(1);
    }
}

main();

process.once('SIGINT', () => {
    bot.stop('SIGINT');
    db.pool.end();
});

process.once('SIGTERM', () => {
    bot.stop('SIGTERM');
    db.pool.end();
});