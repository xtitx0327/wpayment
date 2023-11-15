# WPayment

**零费率 零风险**：基于 wechaty + 赞赏码的微信免签支付方案 💰

## 目录

- [WPayment](#wpayment)
  - [目录](#目录)
  - [简介与开发背景](#简介与开发背景)
  - [安装使用](#安装使用)
  - [声明](#声明)

## 简介与开发背景

众所周知，接入微信支付接口需要商家资质，过程中有严格的审核，还需要缴纳一定的审核费用；审核通过后，微信也会对每笔交易收取一定的手续费. 即使使用其他平台的免签支付，也要缴纳相关费用，且资金安全得不到保证. 而现有的开源免签支付也都是用监控手机端微信通知来实现的，对设备要求高且容易引起风控. 这些解决方案都不适用于个人开发者和较小规模的网站.

于是，WPayment 应运而生. 它基于知名的 [wechaty](https://github.com/wechaty/wechaty) SDK 监听微信消息，而利用赞赏码这一机制实现收款. 赞赏码可以任选金额和自定义备注，这可以方便地用于任意指定小额（单笔赞赏的金额不能超过 200 元）订单的支付，且不需要利用金额来区分不同的用户. 同时，赞赏码设定上就是用于接收来自全国各地网友的赞赏的，所以不像收款码那样容易被风控.

## 安装使用

使用 npm 安装：
```
npm install --save wpayment
```

基本的使用流程为：
1. 创建一个 `WPayment` 对象，调用 `login()` 方法获取微信登录链接，请自行转化为二维码后用**收款者**的微信登录；
2. 登录后可在需要时调用 `createOrder()` 方法创建订单，并记下返回的 `Order` 对象的 `verifyCode` 属性（一个四位数字）；
3. 此时，用户可以扫描收款者的**赞赏码**（不是收款码！），**准确无误**地填写付款金额，并在“备注”一栏输入 `verifyCode`，然后支付.
4. 支付完成后，`createOrder()` 方法参数中的 `onPaid()` 回调将会被调用.

另外，考虑到用户误操作的情况（如忘记输错金额、输错 `verifyCode`、订单超时后才支付），`WPayment` 对象还提供了 `queryOrder` 方法，确保可通过付款者微信昵称、付款金额、微信转账单号等方式查询订单信息. 更详细的使用说明，见 `/docs/document.md`. 

一个简单的 Demo 如下：
```javascript
const WPayment = require('wpayment').default;
const qrcode = require('qrcode');

let intervalID, timeLeft = 300;

const payment = new WPayment();

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
```

## 声明

本项目完全免费，仅供教育与学习，不得用于任何违法目的.