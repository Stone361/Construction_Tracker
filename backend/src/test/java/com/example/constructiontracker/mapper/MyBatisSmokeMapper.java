package com.example.constructiontracker.mapper;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

@Mapper
public interface MyBatisSmokeMapper {

    int selectValue(@Param("value") int value);
}
