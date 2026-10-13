package com.example.constructiontracker.mapper;

import com.example.constructiontracker.domain.House;
import com.example.constructiontracker.domain.PhotoMetadata;
import com.example.constructiontracker.dto.HouseListQuery;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

@Mapper
public interface HouseMapper {
    House findByPermitNo(@Param("permitNo") String permitNo);

    House findById(@Param("id") Long id);

    List<PhotoMetadata> findPhotosByHouseId(@Param("houseId") Long houseId);

    List<House> findAll(@Param("query") HouseListQuery query);

    int insert(@Param("house") House house);
}
