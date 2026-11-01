-- Frota: o veículo guarda se tem AETC (Autorização Especial de Trânsito de Caminhão, cadastro DSV de São Paulo).
-- Sem ela, VUC é tratado como caminhão comum na ZMRC e no rodízio, e o roteador (has_aetc) só a recebia por viagem.
-- Achado da simulação de 60 dias: todo VUC da frota caía como "entrega em zona proibida" até a AETC ser informada.
alter table vehicles add column if not exists has_aetc boolean not null default false;
