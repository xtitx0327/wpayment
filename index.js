"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
const wechaty_1 = require("wechaty");
const xml2js = __importStar(require("xml2js"));
const sqlite_1 = require("sqlite");
const sqlite3 = __importStar(require("sqlite3"));
class OrderStatus {
}
OrderStatus.WAITING = 'WAITING';
OrderStatus.SUCCESS = 'SUCCESS';
OrderStatus.TIMEDOUT = 'TIMEDOUT';
OrderStatus.CANCELED = 'CANCELED';
OrderStatus.ERROR = 'ERROR';
class Order {
    constructor(amount) {
        this.orderID = ((new Date()).getTime()).toString() + ((Math.random() * 0.9 + 0.1) * 100).toFixed(0).toString();
        this.amount = amount;
        this.createTime = new Date();
        this.verifyCode = ((Math.random() * 0.9 + 0.1) * 10000).toFixed(0).toString();
        this.status = OrderStatus.WAITING;
    }
}
class WPayment {
    constructor() {
        this.loginStatus = false;
        this.waitingOrderList = [];
        (0, sqlite_1.open)({
            filename: './orders.db',
            driver: sqlite3.Database
        }).then((database) => {
            this.db = database;
        });
        this.wechaty = wechaty_1.WechatyBuilder.build();
        this.wechaty.on('scan', (link) => {
            this.loginLink = link;
            if (this.onLoginRequest)
                this.onLoginRequest(() => { return this.loginLink; });
        })
            .on('login', (user) => {
            this.loginStatus = true;
            this.onLoginRequest = undefined;
            this.onLoginSuccess(user.name());
        })
            .on('message', (message) => {
            if (message.talker().name() !== '微信支付')
                return;
            xml2js.parseString(message.text(), (error, result) => {
                if (error) {
                    console.log(error);
                    return;
                }
                try {
                    const des = result.msg.appmsg[0].des[0];
                    const amount = des.split('￥')[1].split('.')[0] + '.' + des.split('￥')[1].split('.')[1].slice(0, 2);
                    let from = undefined;
                    if (des.indexOf('来自') !== -1)
                        from = des.split('来自')[1].split('\n')[0];
                    let comment = undefined;
                    if (des.indexOf('留言') !== -1)
                        comment = des.split('留言')[1].split('\n')[0];
                    const time = des.split('时间')[1].split('\n')[0];
                    const transID = result.msg.appmsg[0].url[0].split('trans_id=')[1].split('&amp;')[0];
                    let order = undefined;
                    for (let i = 0; i < this.waitingOrderList.length; i++)
                        if (this.waitingOrderList[i].verifyCode === comment && this.waitingOrderList[i].amount === amount) {
                            order = this.waitingOrderList[i];
                            order.status = OrderStatus.SUCCESS;
                            if (from)
                                order.payer = from;
                            if (comment)
                                order.comment = comment;
                            order.paidTime = new Date(time);
                            order.transID = transID;
                            this.waitingOrderList.splice(i, 1);
                            this.db.run('UPDATE orders SET status = ?, transID = ?, paidTime = ?, payer = ? WHERE orderID = ?', [OrderStatus.SUCCESS, transID, new Date(time).getTime(), from, order.orderID]);
                            if (order.orderID)
                                order.onPaid(order.orderID);
                            else if (order.onFail)
                                order.onFail(new Error('Order not found'));
                            break;
                        }
                    if (!order) {
                        this.db.run('INSERT INTO unverifiedOrders (amount, transID, paidTime, payer, comment) VALUES (?, ?, ?, ?, ?)', [amount, transID, new Date(time).getTime(), from, comment], (error) => { if (error)
                            console.log(error); });
                    }
                }
                catch (error) {
                    return;
                }
            });
        });
    }
    login(onRequest, onSuccess, onFail) {
        if (this.loginStatus) {
            onFail(new Error('Already logged in'));
            return;
        }
        this.wechaty.start()
            .then(() => {
            this.loginStatus = true;
            this.onLoginRequest = onRequest;
            this.onLoginSuccess = onSuccess;
        })
            .catch((error) => {
            onFail(error);
        });
    }
    createOrder(amount, onPaid, onFail, timeout) {
        if (!/^\d+\.\d{2}$/.test(amount)) {
            if (onFail)
                onFail(new Error('Invalid amount'));
            return new Error('Invalid amount');
        }
        const newOrder = new Order(amount);
        newOrder.onPaid = onPaid;
        newOrder.onFail = onFail;
        if (newOrder.createTime)
            newOrder.expire = timeout ? new Date(newOrder.createTime.getTime() + timeout * 1000) : new Date(newOrder.createTime.getTime() + 300 * 1000);
        setTimeout(() => {
            if (newOrder.status === OrderStatus.WAITING) {
                newOrder.status = OrderStatus.TIMEDOUT;
                this.db.run('UPDATE orders SET status = ? WHERE orderID = ?', [OrderStatus.TIMEDOUT, newOrder.orderID]);
                for (let i = 0; i < this.waitingOrderList.length; i++)
                    if (this.waitingOrderList[i].orderID === newOrder.orderID) {
                        this.waitingOrderList.splice(i, 1);
                        break;
                    }
                if (newOrder.onFail)
                    newOrder.onFail(new Error('Order timed out'));
                return new Error('Order timed out');
            }
        }, timeout ? timeout * 1000 : 300 * 1000);
        this.waitingOrderList.push(newOrder);
        if (newOrder.createTime && newOrder.expire)
            this.db.run('INSERT INTO orders (orderID, amount, createTime, expire, verifyCode, status) VALUES (?, ?, ?, ?, ?, ?)', [newOrder.orderID, newOrder.amount, newOrder.createTime.getTime(), newOrder.expire.getTime(), newOrder.verifyCode, OrderStatus.WAITING], (error) => {
                if (error) {
                    if (onFail)
                        onFail(error);
                    return error;
                }
            });
        return newOrder;
    }
    cancelOrder(orderID) {
        this.db.run('UPDATE orders SET status = ? WHERE orderID = ?', [OrderStatus.CANCELED, orderID], (error) => { if (error)
            console.log(error); });
        for (let i = 0; i < this.waitingOrderList.length; i++)
            if (this.waitingOrderList[i].orderID === orderID) {
                this.waitingOrderList[i].status = OrderStatus.CANCELED;
                this.waitingOrderList.splice(i, 1);
                return true;
            }
        return false;
    }
    queryOrder(onSuccess, onFail, orderID, payer, amount, comment, transID) {
        if (orderID) {
            for (let i = 0; i < this.waitingOrderList.length; i++)
                if (this.waitingOrderList[i].orderID === orderID) {
                    onSuccess(this.waitingOrderList[i]);
                    return;
                }
            this.db.get('SELECT * FROM orders WHERE orderID = ?', [orderID])
                .then((row) => {
                const newOrder = new Order(row.amount);
                newOrder.orderID = row.orderID;
                newOrder.createTime = new Date(row.createTime);
                newOrder.expire = new Date(row.expire);
                newOrder.verifyCode = row.verifyCode;
                newOrder.status = row.status;
                newOrder.transID = row.transID;
                newOrder.paidTime = new Date(row.paidTime);
                newOrder.payer = row.payer;
                newOrder.comment = row.comment;
                onSuccess(newOrder);
            })
                .catch((error) => {
                onFail(error);
            });
        }
        else if (transID) {
            this.db.get('SELECT * FROM orders WHERE transID = ?', [transID])
                .then((row) => {
                if (row) {
                    const newOrder = new Order(row.amount);
                    newOrder.orderID = row.orderID;
                    newOrder.createTime = new Date(row.createTime);
                    newOrder.expire = new Date(row.expire);
                    newOrder.verifyCode = row.verifyCode;
                    newOrder.status = row.status;
                    newOrder.transID = row.transID;
                    newOrder.paidTime = new Date(row.paidTime);
                    newOrder.payer = row.payer;
                    newOrder.comment = row.comment;
                    onSuccess(newOrder);
                    return;
                }
                else {
                    this.db.get('SELECT * FROM unverifiedOrders WHERE transID = ?', [transID])
                        .then((row) => {
                        const newOrder = new Order(row.amount);
                        newOrder.orderID = null;
                        newOrder.createTime = null;
                        newOrder.expire = null;
                        newOrder.verifyCode = null;
                        newOrder.status = OrderStatus.ERROR;
                        newOrder.transID = row.transID;
                        newOrder.paidTime = new Date(row.paidTime);
                        newOrder.payer = row.payer;
                        newOrder.comment = row.comment;
                        onSuccess(newOrder);
                    })
                        .catch((error) => {
                        onFail(error);
                    });
                }
            })
                .catch((error) => {
                onFail(error);
            });
        }
        else if (amount) {
            if (payer && comment) {
                this.db.get('SELECT * FROM unverifiedOrders WHERE amount = ? AND payer = ? AND comment = ?', [amount, payer, comment])
                    .then((row) => {
                    const newOrder = new Order(row.amount);
                    newOrder.orderID = null;
                    newOrder.createTime = null;
                    newOrder.expire = null;
                    newOrder.verifyCode = null;
                    newOrder.status = OrderStatus.ERROR;
                    newOrder.transID = row.transID;
                    newOrder.paidTime = new Date(row.paidTime);
                    newOrder.payer = row.payer;
                    newOrder.comment = row.comment;
                    onSuccess(newOrder);
                })
                    .catch((error) => {
                    onFail(error);
                });
            }
            else if (payer) {
                this.db.get('SELECT * FROM unverifiedOrders WHERE amount = ? AND payer = ?', [amount, payer])
                    .then((row) => {
                    const newOrder = new Order(row.amount);
                    newOrder.orderID = null;
                    newOrder.createTime = null;
                    newOrder.expire = null;
                    newOrder.verifyCode = null;
                    newOrder.status = OrderStatus.ERROR;
                    newOrder.transID = row.transID;
                    newOrder.paidTime = new Date(row.paidTime);
                    newOrder.payer = row.payer;
                    newOrder.comment = row.comment;
                    onSuccess(newOrder);
                })
                    .catch((error) => {
                    onFail(error);
                });
            }
            else if (comment) {
                this.db.get('SELECT * FROM unverifiedOrders WHERE amount = ? AND comment = ?', [amount, comment])
                    .then((row) => {
                    const newOrder = new Order(row.amount);
                    newOrder.orderID = null;
                    newOrder.createTime = null;
                    newOrder.expire = null;
                    newOrder.verifyCode = null;
                    newOrder.status = OrderStatus.ERROR;
                    newOrder.transID = row.transID;
                    newOrder.paidTime = new Date(row.paidTime);
                    newOrder.payer = row.payer;
                    newOrder.comment = row.comment;
                    onSuccess(newOrder);
                })
                    .catch((error) => {
                    onFail(error);
                });
            }
        }
    }
}
exports.default = WPayment;
;
