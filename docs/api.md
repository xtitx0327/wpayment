# WeChaty-Payment 免签支付 | API 文档

待完善

1. WPayment 对象
2. WPayment.login(successCallback: function) 方法：登录成功后执行 successCallback 回调
3. WPayment.createOrder(amount? : String, timeout? : Number = 300, ): String 方法：创建金额为 amount（必须为 "*.xx" 格式的字符串） 的订单，返回订单的系统内编号（非微信订单编号）