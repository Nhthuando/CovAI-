import axios from "axios";

const API_URL = "/api/git";

export const gitService = {
  runCommand: async (projectId, command, args = []) => {
    const response = await axios.post(`${API_URL}/command`, {
      projectId,
      command,
      args,
    });
    return response.data;
  },
};
