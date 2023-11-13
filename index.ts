import { Message, WechatyBuilder } from 'wechaty';
import * as xml2js from 'xml2js';
import { Database, open } from 'sqlite';
import * as sqlite3 from 'sqlite3';
import { WechatyInterface } from 'wechaty/impls';

class OrderStatus {
    public static readonly WAITING = 'WAITING';    // 等待用户完成支付
    public static readonly SUCCESS = 'SUCCESS';    // 已完成支付
    public static readonly TIMEDOUT = 'TIMEDOUT';  // 订单超时
    public static readonly CANCELED = 'CANCELED';  // 用户或商家主动取消订单
    public static readonly ERROR = 'ERROR';        // 遇到错误，订单异常
}

class Order {
    orderID: string | null;
    amount: string;
    createTime: Date | null;
    expire: Date | null;
    verifyCode: string | null;
    status: OrderStatus;
    transID: string;

    onPaid: (orderID: string) => void;
    onFail: ((error: Error) => void) | undefined;

    paidTime: Date;
    payer: string;
    comment: string;

    constructor(amount: string) {
        // 根据精确日期时间和随机的两位数生成唯一订单号
        this.orderID = ((new Date()).getTime()).toString() + ((Math.random() * 0.9 + 0.1) * 100).toFixed(0).toString();
        // 此时应已完成了对 amount 的校验
        this.amount = amount;
        this.createTime = new Date();
        // 生成四位随机验证码
        this.verifyCode = ((Math.random() * 0.9 + 0.1) * 10000).toFixed(0).toString();
        this.status = OrderStatus.WAITING;
    }
}

interface WPaymentInterface {
    /**
     * 登录微信
     * @param onRequest 发起登录请求后的回调
     * @param onSuccess 登录成功回调 
     * @param onFail 登录失败回调
     * @returns 获取最新扫码登录链接的函数
     */
    login(onRequest: (linkGetter: () => string) => void, onSuccess: () => void, onFail: (error: Error) => void): void;

    /**
     * 创建订单
     * @param amount 订单金额，必须为“*.xx”的格式，即带有小数点后两位的字符串
     * @param onPaid 支付成功回调
     * @param onFail 支付失败回调
     * @param timeout 超时时间，单位为秒，默认值为 300
     * @returns 若订单创建成功，返回订单实例，否则返回 Error
     */
    createOrder(amount: string, onPaid: (orderID: string) => void, onFail?: (error: Error) => void, timeout?: number): Order | Error;

    /**
     * 取消一个处于 WAITING 状态的订单
     * @param orderID 订单编号
     * @returns 是否取消成功
     */
    cancelOrder(orderID: string): boolean;

    /**
     * 在所有历史订单中查询
     * @param onSuccess 查询成功回调，函数参数为查询到的订单实例
     * @param onFail 查询失败回调
     * @param orderID 系统内订单号，若非空，则仅会根据此参数进行查询
     * @param payer 支付者微信昵称
     * @param amount 订单金额，此参数若非空，则 payer 和 comment 项至少有一个非空
     * @param comment 留言
     * @param transID 微信订单号，若 orderID 为空且此项非空，则仅会根据此参数进行查询
     */
    queryOrder(onSuccess: (order: Order | null) => void, onFail: (error: Error) => void, orderID?: string, payer?: string, amount?: string, comment?: string, transID?: string): void;
}

export default class WPayment implements WPaymentInterface {
    // Wechaty 实例
    private wechaty: WechatyInterface;
    // 登录状态
    private loginStatus: boolean = false;
    // 处于 Waiting 状态的订单列表
    private waitingOrderList: Array<Order> = [];
    // 最新的微信登录链接
    private loginLink: string;
    // 数据库实例
    private db: Database;
    // 登录请求回调
    private onLoginRequest: ((linkGetter: () => string) => void) | undefined;
    // 登录成功回调
    private onLoginSuccess: ((nickname: string) => void);

    public constructor() {
        open({
            filename: './orders.db',
            driver: sqlite3.Database
        }).then((database) => {
            this.db = database;
        });
        this.wechaty = WechatyBuilder.build();

        this.wechaty.on('scan', (link: string) => {
            this.loginLink = link;
            if (this.onLoginRequest)
                this.onLoginRequest(() => { return this.loginLink; });
        })
            .on('login', (user: any) => {
                this.loginStatus = true;
                this.onLoginRequest = undefined;
                this.onLoginSuccess(user.name());
            })
            .on('message', (message: Message) => {
                if (message.talker().name() !== '微信支付')
                    return;
                xml2js.parseString(message.text(), (error: Error, result: any) => {
                    if (error) {
                        console.log(error);
                        return;
                    }
                    try {
                        const des: string = result.msg.appmsg[0].des[0];
                        const amount: string = des.split('￥')[1].split('.')[0] + '.' + des.split('￥')[1].split('.')[1].slice(0, 2);

                        let from: string | undefined = undefined;
                        if (des.indexOf('来自') !== -1)
                            from = des.split('来自')[1].split('\n')[0];

                        let comment: string | undefined = undefined;
                        if (des.indexOf('留言') !== -1)
                            comment = des.split('留言')[1].split('\n')[0];

                        const time: string = des.split('时间')[1].split('\n')[0];
                        const transID: string = result.msg.appmsg[0].url[0].split('trans_id=')[1].split('&amp;')[0];

                        // console.log('金额：' + amount);
                        // if (from)
                        //     console.log('来自：' + from);
                        // if (comment)
                        //     console.log('留言：' + comment);
                        // console.log('时间：' + time);
                        // console.log('微信订单号：' + transID);

                        // 在 waitingOrderList 中根据 verifyCode 和 amount 查询订单
                        let order: Order | undefined = undefined;
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

                        // 若未查询到，则将收款信息记录在 unverifiedOrders 表中
                        if (!order) {
                            this.db.run('INSERT INTO unverifiedOrders (amount, transID, paidTime, payer, comment) VALUES (?, ?, ?, ?, ?)', [amount, transID, new Date(time).getTime(), from, comment], (error: Error | null) => { if (error) console.log(error); });
                        }
                    } catch (error) {
                        // 无法解析的消息
                        return;
                    }
                });
            });
    }

    public login(onRequest: (linkGetter: () => string) => void, onSuccess: (nickname: string) => void, onFail: (error: Error) => void): void {
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
            .catch((error: Error) => {
                onFail(error);
            });
    }

    public createOrder(amount: string, onPaid: (orderID: string) => void, onFail?: (error: Error) => void, timeout?: number): Order | Error {
        // amount 格式检查
        if (!/^\d+\.\d{2}$/.test(amount)) {
            if (onFail)
                onFail(new Error('Invalid amount'));
            return new Error('Invalid amount');
        }

        // 创建订单实例
        const newOrder = new Order(amount);
        newOrder.onPaid = onPaid;
        newOrder.onFail = onFail;
        if (newOrder.createTime)
            newOrder.expire = timeout ? new Date(newOrder.createTime.getTime() + timeout * 1000) : new Date(newOrder.createTime.getTime() + 300 * 1000);
        setTimeout(() => {
            if (newOrder.status === OrderStatus.WAITING) {
                newOrder.status = OrderStatus.TIMEDOUT;
                this.db.run('UPDATE orders SET status = ? WHERE orderID = ?', [OrderStatus.TIMEDOUT, newOrder.orderID]);
                // 从 orderList 中删除该订单
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
            this.db.run('INSERT INTO orders (orderID, amount, createTime, expire, verifyCode, status) VALUES (?, ?, ?, ?, ?, ?)', [newOrder.orderID, newOrder.amount, newOrder.createTime.getTime(), newOrder.expire.getTime(), newOrder.verifyCode, OrderStatus.WAITING], (error: Error | null) => {
                if (error) {
                    if (onFail)
                        onFail(error);
                    return error;
                }
            });

        return newOrder;
    }

    public cancelOrder(orderID: string): boolean {
        this.db.run('UPDATE orders SET status = ? WHERE orderID = ?', [OrderStatus.CANCELED, orderID], (error: Error | null) => { if (error) console.log(error); });
        for (let i = 0; i < this.waitingOrderList.length; i++)
            if (this.waitingOrderList[i].orderID === orderID) {
                this.waitingOrderList[i].status = OrderStatus.CANCELED;
                this.waitingOrderList.splice(i, 1);
                return true;
            }
        return false;
    }

    public queryOrder(onSuccess: (order: Order | null) => void, onFail: (error: Error) => void, orderID?: string, payer?: string, amount?: string, comment?: string, transID?: string): void {
        if (orderID) {
            // 先在 waitingOrderList 中查询
            for (let i = 0; i < this.waitingOrderList.length; i++)
                if (this.waitingOrderList[i].orderID === orderID) {
                    onSuccess(this.waitingOrderList[i]);
                    return;
                }
            // 若非 WAITING 状态，则从数据库中查询
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
                .catch((error: Error) => {
                    onFail(error);
                });
        } else if (transID) {
            // 从数据库中查询
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
                    } else {
                        // 若还没有查询到结果，则在 unverifiedOrders 表中查询
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
                        .catch((error: Error) => {
                            onFail(error);
                        }) 
                    }
                })
                .catch((error: Error) => {
                    onFail(error);
                });
        } else if (amount) {
            // 此时仅在 unverifiedOrders 表中查询
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
                    .catch((error: Error) => {
                        onFail(error);
                    });
            } else if (payer) {
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
                    .catch((error: Error) => {
                        onFail(error);
                    });
            } else if (comment) {
                this.db.get('SELECT * FROM unverifiedOrders WHERE amount = ? AND comment = ?', [amount,comment])
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
                    .catch((error: Error) => {
                        onFail(error);
                    });
            }
        }

    }
};
