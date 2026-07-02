import prismaClient from './src/config/prisma.js';

const prisma = prismaClient;

async function checkNotifications() {
    try {
        console.log('Fetching notifications...');
        const notifications = await prisma.notification.findMany({
            take: 5,
            select: {
                id: true,
                userId: true,
                title: true,
                readAt: true,
                createdAt: true
            },
            orderBy: {
                createdAt: 'desc'
            }
        });

        console.log(`Found ${notifications.length} notifications:`);
        notifications.forEach((notif, index) => {
            console.log(`\n${index + 1}. Notification ID: ${notif.id}`);
            console.log(`   User ID: ${notif.userId}`);
            console.log(`   Title: ${notif.title}`);
            console.log(`   Read At: ${notif.readAt || 'Unread'}`);
            console.log(`   Created At: ${notif.createdAt}`);
        });

        const totalCount = await prisma.notification.count();
        console.log(`\nTotal notifications in DB: ${totalCount}`);

        await prisma.$disconnect();
    } catch (error) {
        console.error('Error:', error);
        await prisma.$disconnect();
        process.exit(1);
    }
}

checkNotifications();