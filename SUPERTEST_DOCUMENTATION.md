# Supertest trong dự án CovAI

## 1. Tầng hoạt động
Supertest hoạt động tại **tầng kiểm thử (Testing Layer)** của dự án, cụ thể là kiểm thử tích hợp (Integration Testing) cho các API endpoint của server. Nó cho phép gửi các HTTP request trực tiếp đến ứng dụng Express mà không cần khởi chạy server trên cổng mạng thực tế.

## 2. Các file liên quan
Các file liên quan đến Supertest được đặt chủ yếu trong thư mục `server/src/services/` và `server/src/tests/`.

### File Service (Logic xử lý)
- `server/src/services/supertestDetection.service.js`: Phát hiện sự tồn tại hoặc cấu hình liên quan đến Supertest.
- `server/src/services/supertestRunner.service.js`: Thực thi các test case sử dụng Supertest.
- `server/src/services/supertestCoverageJob.service.js`: Quản lý job chạy test và thu thập dữ liệu coverage.

### File Test (Unit/Integration Tests)
- `server/src/tests/supertestDetection.service.test.js`
- `server/src/tests/supertestRunner.service.test.js`
- `server/src/tests/supertestCoverage.service.test.js`
- `server/src/tests/supertestCoverageJob.service.test.js`

## 3. Cách sử dụng và Thực thi
Supertest được sử dụng để kiểm thử tích hợp (Integration Testing) thông qua hàm `runSupertest` trong `server/src/services/supertestRunner.service.js`.

### Cơ chế thực thi
Hàm `runSupertest` thực thi các test case bên trong một container Docker bằng cách gọi lệnh:
`NODE_ENV=test npx jest --runInBand --coverage --coverageReporters=json-summary --coverageReporters=json --coverageReporters=lcov --forceExit --testTimeout=30000`

### Ví dụ gọi hàm
```javascript
import { runSupertest } from '../services/supertestRunner.service.js';

// Gọi trong service hoặc job controller
const result = await runSupertest(jobId, rootDir, jestConfigPath, supertestFiles);
```

### Ví dụ viết test case (Integration Test)
Các file test sử dụng Supertest thường nằm trong `server/src/tests/`:
```javascript
const request = require('supertest');
const app = require('../../index'); 

describe('API Tests', () => {
  it('should respond to GET /', async () => {
    const response = await request(app).get('/');
    expect(response.statusCode).toBe(200);
  });
});