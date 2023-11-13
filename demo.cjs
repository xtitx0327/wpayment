const WPayment = require('./index.js').default;
const qrcode = require('qrcode');

let intervalID, timeLeft = 300;

payment.login((linkGetter) => {
    // 登录请求回调
    const link = linkGetter();
    qrcode.toString(link, { type: 'terminal' }, (error, result) => {
        if (error) {
            console.log(error);
            return;
        }
        console.clear();
        console.log('请扫描二维码登录微信：', '\n');
        console.log(result);
    })
}, (nickname) => {
    // 登录成功回调
    console.clear();
    console.log(nickname, '已登录');
    const order = payment.createOrder('0.02', (orderID) => {
        // 订单支付成功回调
        clearInterval(intervalID);
        console.log('\n订单 ' + orderID + ' 已支付！');
        console.log('支付人微信昵称：', order.payer);
        console.log('支付时间：', order.paidTime.toLocaleString());
        console.log('微信订单号：', order.transID);
    }, (error) => {
        // 订单支付失败（系统错误、主动取消或订单超时未支付）回调
        console.log(error);
        clearInterval(intervalID);
    }, 300);
    
    intervalID = setInterval(() => {
        timeLeft -= 1;
        if (timeLeft <= 0) {
            clearInterval(intervalID);
            return;
        }
        console.clear();
        console.log('创建了一笔新订单，金额 0.02 元，动态码为 ' + order.verifyCode);
        console.log('请在', timeLeft, '秒内完成支付');
    }, 1000);
}, (error) => {
    // 登录失败回调
    console.log(error);
});