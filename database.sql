create table user(
    id text,
    twitter_id text not null,
    twitter_name text not null,
    twitter_icon text not null,
    score integer not null,
    valid boolean not null,
    created_at integer not null,
    updated_at integer not null,
    primary key (id)
);

create table solved(
    user text references user(id),
    problem text not null,
    flag text not null,
    created_at integer not null,
    primary key(user, problem, flag)
);
