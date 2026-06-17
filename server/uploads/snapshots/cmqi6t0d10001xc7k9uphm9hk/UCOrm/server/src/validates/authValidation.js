import {z} from "zod";

export const authValid = z.object({
    name: z.string().min(1, "Phải nhập tên!").max(100, "Tên không được quá 100 kí tự!"),
    email: z.email("Phải là email hợp lệ!"),
    password: z.string().min(8, "Vui lòng nhập password từ 8 ký tự trở lên!")   
})