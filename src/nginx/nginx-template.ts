/**
 * Plantilla de configuración de Nginx
 * Genera el archivo de configuración para cada subdominio
 */
export const getNginxConfig = (subdomain: string, port: number) => `
server {
    listen 80;
    server_name ${subdomain}.boogiepop.cloud;

    location / {
        proxy_pass http://localhost:${port};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
`;
