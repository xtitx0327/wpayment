declare class OrderStatus {
    static readonly WAITING = "WAITING";
    static readonly SUCCESS = "SUCCESS";
    static readonly TIMEDOUT = "TIMEDOUT";
    static readonly CANCELED = "CANCELED";
    static readonly ERROR = "ERROR";
}
declare class Order {
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
    constructor(amount: string);
}
interface WPaymentInterface {
    login(onRequest: (linkGetter: () => string) => void, onSuccess: () => void, onFail: (error: Error) => void): void;
    createOrder(amount: string, onPaid: (orderID: string) => void, onFail?: (error: Error) => void, timeout?: number): Order | Error;
    cancelOrder(orderID: string): boolean;
    queryOrder(onSuccess: (order: Order | null) => void, onFail: (error: Error) => void, orderID?: string, payer?: string, amount?: string, comment?: string, transID?: string): void;
}
export default class WPayment implements WPaymentInterface {
    private wechaty;
    private loginStatus;
    private waitingOrderList;
    private loginLink;
    private db;
    private onLoginRequest;
    private onLoginSuccess;
    constructor();
    login(onRequest: (linkGetter: () => string) => void, onSuccess: (nickname: string) => void, onFail: (error: Error) => void): void;
    createOrder(amount: string, onPaid: (orderID: string) => void, onFail?: (error: Error) => void, timeout?: number): Order | Error;
    cancelOrder(orderID: string): boolean;
    queryOrder(onSuccess: (order: Order | null) => void, onFail: (error: Error) => void, orderID?: string, payer?: string, amount?: string, comment?: string, transID?: string): void;
}
export {};
